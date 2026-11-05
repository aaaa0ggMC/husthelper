/**
 * hustnet-auth — 华中科技大学校园网 eportal 认证（零第三方依赖）
 *
 * 与 husthelper 的 examples/chustnet.c 相比：
 *   1. 密码不再经 argv 传递，凭据从文件 / $CREDENTIALS_DIRECTORY 读取；
 *   2. 支持 SO_BINDTODEVICE 绑定指定网卡，认证走指定出口；
 *   3. RSA 公钥在运行时从门户 pageInfo 获取，不依赖编译期模数；
 *   4. 支持 --status 仅探测，不触发登录。
 *
 * 凭据文件格式（两行）：
 *   <学号>
 *   <密码>
 *
 * 编译：
 *   gcc -O2 -Wall -Wextra -o hustnet-auth hustnet-auth.c
 */

#define _GNU_SOURCE

#include <arpa/inet.h>
#include <ctype.h>
#include <errno.h>
#include <fcntl.h>
#include <net/if.h>
#include <netdb.h>
#include <netinet/in.h>
#include <stdarg.h>
#include <stdbool.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <strings.h>
#include <sys/select.h>
#include <sys/socket.h>
#include <sys/time.h>
#include <sys/types.h>
#include <unistd.h>

#define HUSTNET_MINIMAL_C_IMPLEMENTATION
#include "hustnet_minimal.h"

#define DEFAULT_IFACE "enp7s0"
#define DEFAULT_PROBE "connectivitycheck.gstatic.com"
#define DEFAULT_PROBE_PORT 80
#define DEFAULT_PORTAL_PORT 8080
#define RESP_MAX (128 * 1024)
#define CONNECT_TIMEOUT_SEC 6
#define IO_TIMEOUT_SEC 8
#define MAX_REDIRECTS 2

/* 退出码 */
#define RC_OK 0            /* 在线 / 登录成功 */
#define RC_OFFLINE 1       /* --status: 未认证 */
#define RC_NETERR 2        /* 网络错误（探测无响应） */
#define RC_PARSE 3         /* 门户响应解析失败 */
#define RC_ENCRYPT 4       /* 密码加密失败 */
#define RC_PAYLOAD 5       /* 表单构造失败 */
#define RC_LOGIN_NET 6     /* 登录请求无响应 */
#define RC_LOGIN_REJECTED 7/* 门户拒绝登录 */
#define RC_CAPTCHA 8       /* 门户要求图形验证码 */
#define RC_SMS 9           /* 门户要求短信二次验证 */
#define RC_NO_CRED 10      /* 未配置凭据 */

static int g_quiet = 0;

static void log_info(const char *fmt, ...) {
    if (g_quiet) return;
    va_list ap;
    va_start(ap, fmt);
    vfprintf(stdout, fmt, ap);
    va_end(ap);
    fputc('\n', stdout);
    fflush(stdout);
}

static void log_err(const char *fmt, ...) {
    va_list ap;
    va_start(ap, fmt);
    vfprintf(stderr, fmt, ap);
    va_end(ap);
    fputc('\n', stderr);
    fflush(stderr);
}

static void secure_zero(void *ptr, size_t len) {
    volatile unsigned char *p = (volatile unsigned char *)ptr;
    while (len--) *p++ = 0;
}

/* ----------------------------- 网络工具 ----------------------------- */

static int connect_timeout(int sock, const struct sockaddr *addr, socklen_t len, int sec) {
    int flags = fcntl(sock, F_GETFL, 0);
    if (flags < 0) return -1;
    if (fcntl(sock, F_SETFL, flags | O_NONBLOCK) < 0) return -1;

    int rc = connect(sock, addr, len);
    if (rc < 0 && errno == EINPROGRESS) {
        fd_set wf;
        FD_ZERO(&wf);
        FD_SET(sock, &wf);
        struct timeval tv = {sec, 0};
        rc = select(sock + 1, NULL, &wf, NULL, &tv);
        if (rc > 0) {
            int so_err = 0;
            socklen_t el = sizeof(so_err);
            if (getsockopt(sock, SOL_SOCKET, SO_ERROR, &so_err, &el) < 0) {
                rc = -1;
            } else if (so_err != 0) {
                errno = so_err;
                rc = -1;
            } else {
                rc = 0;
            }
        } else if (rc == 0) {
            errno = ETIMEDOUT;
            rc = -1;
        }
    }

    fcntl(sock, F_SETFL, flags);
    return rc;
}

static int tcp_connect(const char *host, int port, const char *iface, char *err, size_t err_len) {
    struct addrinfo hints;
    memset(&hints, 0, sizeof(hints));
    hints.ai_family = AF_INET;
    hints.ai_socktype = SOCK_STREAM;

    struct addrinfo *res = NULL;
    char port_str[16];
    snprintf(port_str, sizeof(port_str), "%d", port);
    int gai = getaddrinfo(host, port_str, &hints, &res);
    if (gai != 0) {
        snprintf(err, err_len, "cannot resolve %s: %s", host, gai_strerror(gai));
        return -1;
    }

    int sock = socket(AF_INET, SOCK_STREAM, 0);
    if (sock < 0) {
        snprintf(err, err_len, "socket() failed: %s", strerror(errno));
        freeaddrinfo(res);
        return -1;
    }

    if (iface && *iface) {
        if (setsockopt(sock, SOL_SOCKET, SO_BINDTODEVICE, iface, (socklen_t)(strlen(iface) + 1)) < 0) {
            snprintf(err, err_len, "cannot bind to interface %s: %s", iface, strerror(errno));
            close(sock);
            freeaddrinfo(res);
            return -1;
        }
    }

    if (connect_timeout(sock, res->ai_addr, res->ai_addrlen, CONNECT_TIMEOUT_SEC) < 0) {
        snprintf(err, err_len, "cannot connect to %s:%d: %s", host, port, strerror(errno));
        close(sock);
        freeaddrinfo(res);
        return -1;
    }
    freeaddrinfo(res);

    struct timeval tv = {IO_TIMEOUT_SEC, 0};
    setsockopt(sock, SOL_SOCKET, SO_RCVTIMEO, &tv, sizeof(tv));
    setsockopt(sock, SOL_SOCKET, SO_SNDTIMEO, &tv, sizeof(tv));
    return sock;
}

static int http_request(
    const char *host,
    int port,
    const char *iface,
    const char *req,
    size_t req_len,
    char *resp,
    size_t resp_max,
    char *err,
    size_t err_len
) {
    int sock = tcp_connect(host, port, iface, err, err_len);
    if (sock < 0) return -1;

    size_t sent = 0;
    while (sent < req_len) {
        ssize_t n = send(sock, req + sent, req_len - sent, 0);
        if (n <= 0) {
            if (errno == EINTR) continue;
            snprintf(err, err_len, "failed to send request: %s", strerror(errno));
            close(sock);
            return -1;
        }
        sent += (size_t)n;
    }

    size_t received = 0;
    while (received + 1 < resp_max) {
        ssize_t n = recv(sock, resp + received, resp_max - 1 - received, 0);
        if (n > 0) {
            received += (size_t)n;
            continue;
        }
        if (n < 0 && errno == EINTR) continue;
        break; /* 对端关闭或超时 */
    }
    resp[received] = '\0';
    close(sock);

    if (received == 0) {
        snprintf(err, err_len, "no response from %s:%d", host, port);
        return -1;
    }
    return (int)received;
}

/* ----------------------------- 文本解析 ----------------------------- */

/** 取 JSON 中 "key":"value" 的 value（仅处理简单转义） */
static int json_get_string(const char *json, const char *key, char *out, size_t out_max) {
    char pat[128];
    snprintf(pat, sizeof(pat), "\"%s\"", key);
    const char *p = strstr(json, pat);
    if (!p) return -1;
    p += strlen(pat);
    while (*p && *p != ':') p++;
    if (!*p) return -1;
    p++;
    while (*p && isspace((unsigned char)*p)) p++;
    if (*p != '"') return -1;
    p++;

    size_t w = 0;
    while (*p && *p != '"' && w + 1 < out_max) {
        if (*p == '\\' && p[1]) {
            p++;
            switch (*p) {
                case 'n': out[w++] = '\n'; break;
                case 't': out[w++] = '\t'; break;
                case 'r': out[w++] = '\r'; break;
                default: out[w++] = *p; break;
            }
            p++;
            continue;
        }
        out[w++] = *p++;
    }
    out[w] = '\0';
    return (int)w;
}

/** 取 Set-Cookie 中某个 cookie 的值 */
static int header_cookie(const char *resp, const char *name, char *out, size_t out_max) {
    size_t name_len = strlen(name);
    const char *p = resp;
    while ((p = strcasestr(p, "set-cookie:")) != NULL) {
        p += strlen("set-cookie:");
        while (*p == ' ') p++;
        if (strncasecmp(p, name, name_len) == 0 && p[name_len] == '=') {
            p += name_len + 1;
            size_t w = 0;
            while (*p && *p != ';' && *p != '\r' && *p != '\n' && w + 1 < out_max) {
                out[w++] = *p++;
            }
            out[w] = '\0';
            return (int)w;
        }
    }
    return -1;
}

/** 取 HTTP 响应头字段值 */
static int header_value(const char *resp, const char *name, char *out, size_t out_max) {
    char pat[64];
    snprintf(pat, sizeof(pat), "\r\n%s:", name);
    const char *p = strcasestr(resp, pat);
    if (!p) return -1;
    p += strlen(pat);
    while (*p == ' ' || *p == '\t') p++;
    size_t w = 0;
    while (*p && *p != '\r' && *p != '\n' && w + 1 < out_max) out[w++] = *p++;
    out[w] = '\0';
    return (int)w;
}

/** 把 HTML 里常见的 &amp; 还原成 & */
static void unescape_amp(char *s) {
    char *src = s;
    char *dst = s;
    while (*src) {
        if (strncmp(src, "&amp;", 5) == 0) {
            *dst++ = '&';
            src += 5;
        } else {
            *dst++ = *src++;
        }
    }
    *dst = '\0';
}

/** 从劫持响应里解析门户 host / port / queryString */
static int parse_portal(
    const char *resp,
    char *host,
    size_t host_max,
    int *port,
    char *qs,
    size_t qs_max
) {
    const char *idx = strstr(resp, "/eportal/");
    if (!idx) return -1;

    const char *start = idx;
    while (start > resp) {
        if (strncmp(start, "http://", 7) == 0) break;
        start--;
    }
    if (strncmp(start, "http://", 7) != 0) return -1;

    const char *p = start + 7;
    const char *host_end = p;
    while (*host_end && *host_end != ':' && *host_end != '/' && *host_end != '\'' &&
           *host_end != '"' && *host_end != '\r' && *host_end != '\n' && *host_end != ' ') {
        host_end++;
    }
    size_t hl = (size_t)(host_end - p);
    if (hl == 0 || hl >= host_max) return -1;
    memcpy(host, p, hl);
    host[hl] = '\0';

    *port = DEFAULT_PORTAL_PORT;
    if (*host_end == ':') *port = atoi(host_end + 1);

    const char *q = strchr(start, '?');
    if (!q) return -1;
    q++;

    size_t w = 0;
    while (*q && *q != '\'' && *q != '"' && *q != '\r' && *q != '\n' &&
           *q != '>' && *q != ' ' && w + 1 < qs_max) {
        qs[w++] = *q++;
    }
    qs[w] = '\0';
    while (w > 0 && (qs[w - 1] == '&' || qs[w - 1] == ';')) qs[--w] = '\0';
    unescape_amp(qs);
    return 0;
}

/* ----------------------------- 凭据 ----------------------------- */

static int load_credential(const char *path, char *user, size_t user_max, char *pass, size_t pass_max) {
    FILE *fp = fopen(path, "r");
    if (!fp) return -1;

    if (!fgets(user, (int)user_max, fp)) {
        fclose(fp);
        return -1;
    }
    if (!fgets(pass, (int)pass_max, fp)) {
        fclose(fp);
        return -1;
    }
    fclose(fp);

    size_t n = strlen(user);
    while (n > 0 && (user[n - 1] == '\n' || user[n - 1] == '\r')) user[--n] = '\0';
    n = strlen(pass);
    while (n > 0 && (pass[n - 1] == '\n' || pass[n - 1] == '\r')) pass[--n] = '\0';

    if (user[0] == '\0' || pass[0] == '\0') return -1;
    return 0;
}

/* ----------------------------- 主流程 ----------------------------- */

static void usage(const char *prog) {
    printf(
        "Usage: %s [options]\n"
        "\n"
        "  --iface <dev>     uplink interface (default %s)\n"
        "  --probe <host>    probe host (default %s)\n"
        "  --service <name>  service/package name (default empty)\n"
        "  --cred <file>     credential file; default $CREDENTIALS_DIRECTORY/hustnet\n"
        "  --status          only probe, do not log in\n"
        "  --quiet           reduce output\n"
        "  -h, --help        show this help\n"
        "\n"
        "Exit codes: 0 online/login ok  1 offline(--status)  2 network error\n"
        "            3 portal parse error  4 encrypt failed  5 payload failed\n"
        "            6 login request failed  7 login rejected  8 captcha required\n"
        "            9 sms verification required  10 no credential\n",
        prog, DEFAULT_IFACE, DEFAULT_PROBE
    );
}

int main(int argc, char *argv[]) {
    const char *iface = DEFAULT_IFACE;
    const char *probe_host = DEFAULT_PROBE;
    const char *service = "";
    const char *cred_path = NULL;
    int status_only = 0;

    for (int i = 1; i < argc; i++) {
        if (strcmp(argv[i], "--iface") == 0 && i + 1 < argc) {
            iface = argv[++i];
        } else if (strcmp(argv[i], "--probe") == 0 && i + 1 < argc) {
            probe_host = argv[++i];
        } else if (strcmp(argv[i], "--service") == 0 && i + 1 < argc) {
            service = argv[++i];
        } else if (strcmp(argv[i], "--cred") == 0 && i + 1 < argc) {
            cred_path = argv[++i];
        } else if (strcmp(argv[i], "--status") == 0) {
            status_only = 1;
        } else if (strcmp(argv[i], "--quiet") == 0) {
            g_quiet = 1;
        } else if (strcmp(argv[i], "-h") == 0 || strcmp(argv[i], "--help") == 0) {
            usage(argv[0]);
            return RC_OK;
        } else {
            log_err("unknown option: %s", argv[i]);
            usage(argv[0]);
            return 2;
        }
    }

    char *resp = malloc(RESP_MAX);
    char *req = malloc(RESP_MAX);
    if (!resp || !req) {
        log_err("out of memory");
        return 2;
    }

    char err[256] = {0};
    char portal_host[128] = {0};
    char qs[4096] = {0};
    int portal_port = DEFAULT_PORTAL_PORT;

    /* 1. 探测是否被门户劫持 */
    int req_len = snprintf(
        req, RESP_MAX,
        "GET / HTTP/1.1\r\n"
        "Host: %s\r\n"
        "User-Agent: hustnet-cloudsafe/1.0\r\n"
        "Connection: close\r\n\r\n",
        probe_host
    );
    log_info("[1/4] probing portal (iface %s -> %s)...", iface, probe_host);

    int resp_len = http_request(probe_host, DEFAULT_PROBE_PORT, iface, req, (size_t)req_len, resp, RESP_MAX, err, sizeof(err));
    if (resp_len < 0) {
        log_err("[error] %s", err);
        free(resp);
        free(req);
        return RC_NETERR;
    }

    if (!strstr(resp, "/eportal/") && !strstr(resp, "InterFace.do")) {
        log_info("[online] no portal hijack detected, network is usable.");
        free(resp);
        free(req);
        return RC_OK;
    }

    if (status_only) {
        log_info("[offline] portal hijack detected, not authenticated.");
        free(resp);
        free(req);
        return RC_OFFLINE;
    }

    if (parse_portal(resp, portal_host, sizeof(portal_host), &portal_port, qs, sizeof(qs)) != 0) {
        log_err("[error] cannot parse portal address from hijack response, snippet:\n%.400s", resp);
        free(resp);
        free(req);
        return RC_PARSE;
    }
    log_info("      portal: %s:%d, queryString %zu bytes", portal_host, portal_port, strlen(qs));

    /* 2. 建立门户会话（index.jsp，拿 JSESSIONID） */
    char cookie[512] = {0};
    char *location = calloc(1, 1024);
    if (!location) {
        free(resp);
        free(req);
        return 2;
    }

    char target_qs[4096];
    snprintf(target_qs, sizeof(target_qs), "%s", qs);

    for (int hop = 0; hop <= MAX_REDIRECTS; hop++) {
        req_len = snprintf(
            req, RESP_MAX,
            "GET /eportal/index.jsp?%s HTTP/1.1\r\n"
            "Host: %s:%d\r\n"
            "User-Agent: hustnet-cloudsafe/1.0\r\n"
            "Accept: text/html,application/xhtml+xml\r\n"
            "Connection: close\r\n"
            "%s%s\r\n",
            target_qs, portal_host, portal_port,
            cookie[0] ? "Cookie: JSESSIONID=" : "",
            cookie[0] ? cookie : ""
        );
        resp_len = http_request(portal_host, portal_port, iface, req, (size_t)req_len, resp, RESP_MAX, err, sizeof(err));
        if (resp_len < 0) {
            log_err("[error] cannot open portal page: %s", err);
            free(location);
            free(resp);
            free(req);
            return RC_PARSE;
        }

        char newcookie[512];
        if (header_cookie(resp, "JSESSIONID", newcookie, sizeof(newcookie)) > 0) {
            snprintf(cookie, sizeof(cookie), "%s", newcookie);
        }

        if (strncmp(resp, "HTTP/1.1 30", 11) == 0 || strncmp(resp, "HTTP/1.0 30", 11) == 0) {
            if (header_value(resp, "Location", location, 1024) > 0) {
                /* 跟随相对/绝对跳转：只保留 query 部分 */
                const char *q = strchr(location, '?');
                if (q) {
                    snprintf(target_qs, sizeof(target_qs), "%s", q + 1);
                } else {
                    snprintf(target_qs, sizeof(target_qs), "%s", qs);
                }
                continue;
            }
        }
        break;
    }
    free(location);

    /* 3. 取运行时 RSA 公钥 */
    char enc_qs[8192];
    if (hustnet_url_encode(qs, enc_qs, sizeof(enc_qs)) < 0) {
        log_err("[error] failed to URL-encode queryString");
        free(resp);
        free(req);
        return RC_PAYLOAD;
    }

    char body[10240];
    snprintf(body, sizeof(body), "queryString=%s", enc_qs);

    req_len = snprintf(
        req, RESP_MAX,
        "POST /eportal/InterFace.do?method=pageInfo HTTP/1.1\r\n"
        "Host: %s:%d\r\n"
        "User-Agent: hustnet-cloudsafe/1.0\r\n"
        "Content-Type: application/x-www-form-urlencoded; charset=UTF-8\r\n"
        "Accept: */*\r\n"
        "Origin: http://%s:%d\r\n"
        "Referer: http://%s:%d/eportal/index.jsp?%s\r\n"
        "X-Requested-With: XMLHttpRequest\r\n"
        "Connection: close\r\n"
        "%s%s\r\n"
        "Content-Length: %zu\r\n\r\n"
        "%s",
        portal_host, portal_port,
        portal_host, portal_port,
        portal_host, portal_port, qs,
        cookie[0] ? "Cookie: JSESSIONID=" : "",
        cookie[0] ? cookie : "",
        strlen(body), body
    );

    log_info("[2/4] fetching portal public key...");
    resp_len = http_request(portal_host, portal_port, iface, req, (size_t)req_len, resp, RESP_MAX, err, sizeof(err));
    if (resp_len < 0) {
        log_err("[error] cannot fetch portal config: %s", err);
        free(resp);
        free(req);
        return RC_PARSE;
    }

    char modulus[4096] = {0};
    char exponent[64] = {0};
    char password_encrypt[16] = "true";
    char valid_code_url[512] = {0};
    char sms_auth[32] = {0};
    if (json_get_string(resp, "publicKeyModulus", modulus, sizeof(modulus)) < 0) {
        log_err("[error] portal did not return publicKeyModulus, response snippet:\n%.400s", resp);
        free(resp);
        free(req);
        return RC_PARSE;
    }
    json_get_string(resp, "publicKeyExponent", exponent, sizeof(exponent));
    json_get_string(resp, "passwordEncrypt", password_encrypt, sizeof(password_encrypt));
    if (exponent[0] == '\0') snprintf(exponent, sizeof(exponent), "10001");

    /* 人工挑战：验证码 / 短信二次验证，无法自动完成 */
    json_get_string(resp, "validCodeUrl", valid_code_url, sizeof(valid_code_url));
    json_get_string(resp, "isCheckSmsAuth", sms_auth, sizeof(sms_auth));
    if (valid_code_url[0] != '\0') {
        log_err("[captcha] portal requires an image captcha (%s); automatic login is not possible, "
                "please open the portal in a browser and log in once", valid_code_url);
        free(resp);
        free(req);
        return RC_CAPTCHA;
    }
    if (strcasecmp(sms_auth, "true") == 0) {
        log_err("[sms] portal requires SMS verification; automatic login is not possible, "
                "please open the portal in a browser and log in once (or ask the network center "
                "to bind this MAC as a trusted terminal)");
        free(resp);
        free(req);
        return RC_SMS;
    }

    /* 4. 读取凭据 → 加密 → 提交 */
    char user[256] = {0};
    char pass[1024] = {0};
    char resolved_cred[512] = {0};

    if (cred_path) {
        snprintf(resolved_cred, sizeof(resolved_cred), "%s", cred_path);
    } else {
        const char *dir = getenv("CREDENTIALS_DIRECTORY");
        if (dir && *dir) {
            snprintf(resolved_cred, sizeof(resolved_cred), "%s/hustnet", dir);
        }
    }

    if (resolved_cred[0] == '\0') {
        log_err("[skip] no credential specified: run under systemd (LoadCredentialEncrypted) "
                "or pass --cred <file>");
        free(resp);
        free(req);
        return RC_NO_CRED;
    }

    if (load_credential(resolved_cred, user, sizeof(user), pass, sizeof(pass)) != 0) {
        log_err("[skip] no usable credential at %s; run: hustnet-cs set <username>", resolved_cred);
        free(resp);
        free(req);
        return RC_NO_CRED;
    }

    char enc_password[4096] = {0};
    bool need_encrypt = strcasecmp(password_encrypt, "false") != 0;
    const char *password_field = pass;

    if (need_encrypt) {
        log_info("[3/4] encrypting password and submitting...");
        int enc_len = hustnet_encrypt_password_ex(
            pass, modulus, exponent, enc_password, sizeof(enc_password)
        );
        if (enc_len < 0) {
            log_err("[error] password encryption failed: %d", enc_len);
            secure_zero(pass, sizeof(pass));
            free(resp);
            free(req);
            return RC_ENCRYPT;
        }
        password_field = enc_password;
    } else {
        log_info("[3/4] submitting login (portal did not require encryption)...");
    }

    char payload[16384];
    int payload_len = hustnet_build_login_payload(user, password_field, qs, service, payload, sizeof(payload));
    if (payload_len < 0) {
        log_err("[error] failed to build login form: %d", payload_len);
        secure_zero(pass, sizeof(pass));
        secure_zero(enc_password, sizeof(enc_password));
        free(resp);
        free(req);
        return RC_PAYLOAD;
    }

    req_len = snprintf(
        req, RESP_MAX,
        "POST /eportal/InterFace.do?method=login HTTP/1.1\r\n"
        "Host: %s:%d\r\n"
        "User-Agent: hustnet-cloudsafe/1.0\r\n"
        "Content-Type: application/x-www-form-urlencoded; charset=UTF-8\r\n"
        "Accept: */*\r\n"
        "Origin: http://%s:%d\r\n"
        "Referer: http://%s:%d/eportal/index.jsp?%s\r\n"
        "X-Requested-With: XMLHttpRequest\r\n"
        "Connection: close\r\n"
        "%s%s\r\n"
        "Content-Length: %d\r\n\r\n"
        "%s",
        portal_host, portal_port,
        portal_host, portal_port,
        portal_host, portal_port, qs,
        cookie[0] ? "Cookie: JSESSIONID=" : "",
        cookie[0] ? cookie : "",
        payload_len, payload
    );

    secure_zero(pass, sizeof(pass));
    secure_zero(enc_password, sizeof(enc_password));

    resp_len = http_request(portal_host, portal_port, iface, req, (size_t)req_len, resp, RESP_MAX, err, sizeof(err));
    if (resp_len < 0) {
        log_err("[error] no response after submitting login: %s", err);
        free(resp);
        free(req);
        return RC_LOGIN_NET;
    }

    if (strstr(resp, "\"result\":\"success\"") || strstr(resp, "'result':'success'")) {
        log_info("[4/4] login succeeded.");
        free(resp);
        free(req);
        return RC_OK;
    }

    char msg[512] = {0};
    if (json_get_string(resp, "message", msg, sizeof(msg)) < 0 || msg[0] == '\0') {
        snprintf(msg, sizeof(msg), "%.300s", resp);
    }
    log_err("[failed] login rejected: %s", msg);
    free(resp);
    free(req);
    return RC_LOGIN_REJECTED;
}
