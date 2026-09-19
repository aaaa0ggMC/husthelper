/**
 * @file chustnet.c
 * @author aaaa0ggmc (lovelinux@yslwd.eu.org)
 * @brief 华中科技大学校园网极简 Linux C 语言认证程序
 * 
 * 编译方式（零第三方库依赖，纯原生 POSIX Socket）：
 *   gcc -O2 chustnet.c -o chustnet
 * 
 * 运行方式：
 *   ./chustnet <学号/账号> <密码> [套餐名] [探测IP]
 * 示例：
 *   ./chustnet U202512345 my_secret_password
 */

#define _POSIX_C_SOURCE 200112L
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <errno.h>
#include <sys/types.h>
#include <sys/socket.h>
#include <netinet/in.h>
#include <arpa/inet.h>
#include <netdb.h>
#include <sys/time.h>

#define HUSTNET_MINIMAL_C_IMPLEMENTATION
#include "../hustnet_minimal.h"

#define DEFAULT_PROBE_HOST "baidu.com"
#define DEFAULT_PROBE_PORT 80
#define DEFAULT_PORTAL_PORT 8080
#define BUFFER_SIZE 8192

/**
 * @brief 创建带超时设置的 TCP Socket 连接
 */
static int tcp_connect(const char *host, int port, int timeout_sec) {
    int sock = socket(AF_INET, SOCK_STREAM, 0);
    if (sock < 0) {
        perror("socket 创建失败");
        return -1;
    }

    struct timeval tv;
    tv.tv_sec = timeout_sec;
    tv.tv_usec = 0;
    setsockopt(sock, SOL_SOCKET, SO_RCVTIMEO, (const char *)&tv, sizeof(tv));
    setsockopt(sock, SOL_SOCKET, SO_SNDTIMEO, (const char *)&tv, sizeof(tv));

    struct sockaddr_in serv_addr;
    memset(&serv_addr, 0, sizeof(serv_addr));
    serv_addr.sin_family = AF_INET;
    serv_addr.sin_port = htons((uint16_t)port);

    if (inet_pton(AF_INET, host, &serv_addr.sin_addr) <= 0) {
        struct hostent *he = gethostbyname(host);
        if (!he) {
            fprintf(stderr, "无法解析主机名: %s\n", host);
            close(sock);
            return -1;
        }
        memcpy(&serv_addr.sin_addr, he->h_addr_list[0], (size_t)he->h_length);
    }

    if (connect(sock, (struct sockaddr *)&serv_addr, sizeof(serv_addr)) < 0) {
        perror("TCP 连接失败");
        close(sock);
        return -1;
    }

    return sock;
}

/**
 * @brief 发送简单 HTTP 请求并接收完整响应
 */
static int http_request(
    const char *host,
    int port,
    const char *req_data,
    size_t req_len,
    char *resp_buf,
    size_t resp_max_size
) {
    int sock = tcp_connect(host, port, 5);
    if (sock < 0) return -1;

    size_t sent = 0;
    while (sent < req_len) {
        ssize_t n = send(sock, req_data + sent, req_len - sent, 0);
        if (n <= 0) {
            perror("发送 HTTP 请求数据失败");
            close(sock);
            return -1;
        }
        sent += (size_t)n;
    }

    size_t received = 0;
    while (received + 1 < resp_max_size) {
        ssize_t n = recv(sock, resp_buf + received, resp_max_size - 1 - received, 0);
        if (n <= 0) break; /* 对端关闭或超时 */
        received += (size_t)n;
    }
    resp_buf[received] = '\0';
    close(sock);
    return (int)received;
}

/**
 * @brief 从响应文本中解析子串: 在 prefix 之后、suffix 之前
 */
static int extract_between(
    const char *text,
    const char *prefix,
    const char *suffix,
    char *out,
    size_t out_max
) {
    const char *p = strstr(text, prefix);
    if (!p) return -1;
    p += strlen(prefix);

    const char *q = suffix ? strstr(p, suffix) : NULL;
    size_t len = q ? (size_t)(q - p) : strlen(p);

    if (len + 1 > out_max) len = out_max - 1;
    memcpy(out, p, len);
    out[len] = '\0';
    return (int)len;
}

int main(int argc, char *argv[]) {
    if (argc < 3) {
        printf("==================================================================\n");
        printf("  chustnet - 华中科技大学校园网极简 Linux C 语言认证客户端\n");
        printf("==================================================================\n");
        printf("用法:\n");
        printf("  %s <学号/账号> <密码> [套餐名] [探测IP/域名]\n\n", argv[0]);
        printf("示例:\n");
        printf("  %s U202512345 my_password\n", argv[0]);
        printf("  %s U202512345 my_password student 123.123.123.123\n", argv[0]);
        return 1;
    }

    const char *username = argv[1];
    const char *password = argv[2];
    const char *service = (argc >= 4 && strlen(argv[3]) > 0) ? argv[3] : "";
    const char *probe_host = (argc >= 5 && strlen(argv[4]) > 0) ? argv[4] : DEFAULT_PROBE_HOST;

    printf("[1/3] 正在向 %s 探测校园网劫持跳转...\n", probe_host);

    char probe_req[256];
    int req_len = snprintf(
        probe_req,
        sizeof(probe_req),
        "GET / HTTP/1.1\r\n"
        "Host: %s\r\n"
        "User-Agent: chustnet/1.0\r\n"
        "Connection: close\r\n\r\n",
        probe_host
    );

    static char resp_buf[BUFFER_SIZE];
    int resp_len = http_request(probe_host, DEFAULT_PROBE_PORT, probe_req, (size_t)req_len, resp_buf, sizeof(resp_buf));
    if (resp_len <= 0) {
        fprintf(stderr, "[错误] 探测请求未收到响应（请检查是否已连接校园网 WiFi/网线）。\n");
        return 2;
    }

    /* 检查是否被 eportal 劫持 */
    if (!strstr(resp_buf, "/eportal/") && !strstr(resp_buf, "InterFace.do")) {
        printf("[提示] 未检测到校园网门户劫持（当前网络可能已在线连接，或无需网页认证）。\n");
        return 0;
    }

    /* 解析 portal_ip 与 queryString */
    char portal_ip[128] = "172.18.18.61";
    int portal_port = DEFAULT_PORTAL_PORT;
    char query_string[2048] = {0};

    /* 匹配典型的 location.href='http://172.18.18.61:8080/eportal/index.jsp?wlanuserip=...' */
    char full_url[2560] = {0};
    if (extract_between(resp_buf, "location.href='", "'", full_url, sizeof(full_url)) > 0 ||
        extract_between(resp_buf, "location.href=\"", "\"", full_url, sizeof(full_url)) > 0 ||
        extract_between(resp_buf, "location.replace('", "'", full_url, sizeof(full_url)) > 0 ||
        extract_between(resp_buf, "Location: ", "\r\n", full_url, sizeof(full_url)) > 0) {
        
        char *query_pos = strchr(full_url, '?');
        if (query_pos) {
            snprintf(query_string, sizeof(query_string), "%s", query_pos + 1);
            *query_pos = '\0';
        }

        /* 提取 host 与 port */
        const char *host_start = strstr(full_url, "://");
        host_start = host_start ? (host_start + 3) : full_url;
        char *slash_pos = strchr(host_start, '/');
        if (slash_pos) *slash_pos = '\0';

        char *colon_pos = strchr(host_start, ':');
        if (colon_pos) {
            *colon_pos = '\0';
            portal_port = atoi(colon_pos + 1);
        }
        snprintf(portal_ip, sizeof(portal_ip), "%s", host_start);
    } else {
        /* 直接匹配问号后面的 query */
        if (extract_between(resp_buf, "/eportal/index.jsp?", "'", query_string, sizeof(query_string)) < 0 &&
            extract_between(resp_buf, "/eportal/index.jsp?", "\"", query_string, sizeof(query_string)) < 0) {
            fprintf(stderr, "[错误] 无法从劫持响应中解析出 queryString，原始响应片段:\n%.300s\n", resp_buf);
            return 3;
        }
    }

    printf("      检测到网关: %s:%d\n", portal_ip, portal_port);
    printf("      queryString 长度: %lu 字节\n", (unsigned long)strlen(query_string));

    /* 2. 密码加密与构造 Payload */
    printf("[2/3] 正在使用 hustnet minimal C 进行密码加密与表单装配...\n");
    char enc_password[512];
    int enc_len = hustnet_encrypt_password(password, enc_password, sizeof(enc_password));
    if (enc_len < 0) {
        fprintf(stderr, "[错误] 密码加密失败，错误码: %d\n", enc_len);
        return 4;
    }

    static char payload[BUFFER_SIZE];
    int payload_len = hustnet_build_login_payload(
        username,
        enc_password,
        query_string,
        service,
        payload,
        sizeof(payload)
    );
    if (payload_len < 0) {
        fprintf(stderr, "[错误] 构造登录表单失败，错误码: %d\n", payload_len);
        return 5;
    }

    /* 3. 发送 POST 认证请求 */
    printf("[3/3] 正在向门户提交认证请求...\n");
    static char login_req[BUFFER_SIZE + 512];
    int login_req_len = snprintf(
        login_req,
        sizeof(login_req),
        "POST /eportal/InterFace.do?method=login HTTP/1.1\r\n"
        "Host: %s:%d\r\n"
        "Content-Type: application/x-www-form-urlencoded; charset=UTF-8\r\n"
        "User-Agent: chustnet/1.0\r\n"
        "Content-Length: %d\r\n"
        "Connection: close\r\n\r\n"
        "%s",
        portal_ip,
        portal_port,
        payload_len,
        payload
    );

    resp_len = http_request(portal_ip, portal_port, login_req, (size_t)login_req_len, resp_buf, sizeof(resp_buf));
    if (resp_len <= 0) {
        fprintf(stderr, "[错误] 提交登录表单后未收到网关响应。\n");
        return 6;
    }

    /* 4. 检查并打印结果 */
    if (strstr(resp_buf, "\"result\":\"success\"") || strstr(resp_buf, "'result':'success'")) {
        printf("\n========================================\n");
        printf("  [OK] 校园网登录成功！恭喜联网！\n");
        printf("========================================\n");
        return 0;
    }

    /* 提取服务端返回的错误提示信息 */
    char msg[256] = {0};
    if (extract_between(resp_buf, "\"message\":\"", "\"", msg, sizeof(msg)) > 0 ||
        extract_between(resp_buf, "'message':'", "'", msg, sizeof(msg)) > 0) {
        fprintf(stderr, "\n[失败] 登录未通过: %s\n", msg);
    } else {
        fprintf(stderr, "\n[失败] 登录未成功，服务端响应:\n%.300s\n", resp_buf);
    }
    return 7;
}
