/**
 * @file hustnet_minimal.h
 * @author aaaa0ggmc (lovelinux@yslwd.eu.org)
 * @brief 华中科技大学校园网（eportal）认证最小 C 语言 SDK (Header-Only)
 * @version 1.1.0
 * @date 2026-09-19
 * 
 * @copyright Copyright (c) 2026 aaaa0ggmc
 * 
 * 生成时间: 2026-09-19T06:22:13.428Z
 * 模数位数: 1024-bit (支持通过 HUSTNET_BN_MAX_BITS 扩展)
 *
 * 特性：
 *   1. 零外部依赖：纯 C99 标准编写，无需 OpenSSL、mbedtls 或 GMP 等第三方大数库。
 *   2. 零堆内存分配（No malloc）：全部计算在栈上完成，极度适合 ESP32、STM32、Pico 等嵌入式环境。
 *   3. 极低资源占用（深度优化）：
 *      - 全局静态 RAM (.data/.bss): 0 字节
 *      - Flash 固件体积 (-Os): ~4 KB
 *      - 栈空间峰值 (Peak Stack): ~1.2 KB (payload 构造仅 64 字节)
 *   4. 经典单头文件设计（stb-style）：
 *      - 在且仅在一个 .c / .cpp 文件中定义宏：
 *        #define HUSTNET_MINIMAL_C_IMPLEMENTATION
 *        #include "hustnet_minimal.h"
 *      - 其余需要调用的文件直接 #include "hustnet_minimal.h" 即可。
 *   5. 职责边界：
 *      - 本 SDK 只负责产生加密后的 password 及标准 POST 登录表单 payload。
 *      - 网络数据包发送（HTTP POST）、劫持检测由调用方根据自身硬件协议栈（lwIP/socket/HTTPClient等）自行实现。
 */

#ifndef HUSTNET_MINIMAL_H
#define HUSTNET_MINIMAL_H

#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

/* 默认公钥模数（生成时从校园网门户动态注入） */
#ifndef HUSTNET_DEFAULT_MODULUS
#define HUSTNET_DEFAULT_MODULUS "94dd2a8675fb779e6b9f7103698634cd400f27a154afa67af6166a43fc26417222a79506d34cacc7641946abda1785b7acf9910ad6a0978c91ec84d40b71d2891379af19ffb333e7517e390bd26ac312fe940c340466b4a5d4af1d65c3b5944078f96a1a51a5a53e4bc302818b7c9f63c4a1b07bd7d874cef1c3d4b2f5eb7871"
#endif

/* 默认公钥指数（通常为 10001 即 65537） */
#ifndef HUSTNET_DEFAULT_EXPONENT
#define HUSTNET_DEFAULT_EXPONENT "10001"
#endif

/* 模数最大位数（默认 1024 位，嵌入式最省内存；可定义为 2048） */
#ifndef HUSTNET_BN_MAX_BITS
#define HUSTNET_BN_MAX_BITS 1024
#endif

/* 错误码定义 */
#define HUSTNET_OK                    0
#define HUSTNET_ERR_INVALID_PARAM   (-1)
#define HUSTNET_ERR_BUFFER_TOO_SMALL (-2)
#define HUSTNET_ERR_INVALID_HEX     (-3)
#define HUSTNET_ERR_OVERFLOW        (-4)

/**
 * @brief 使用默认公钥加密密码（复刻 eportal 前端 AuthInterFace.js 的 RSA 算法）。
 *
 * @param password      明文密码字符串（以 \0 结尾）
 * @param out_hex       接收加密后十六进制字符串的缓冲区（对于 1024 位模数，推荐至少 257 字节）
 * @param out_hex_size  输出缓冲区大小
 * @return int 成功返回输出的 hex 字符串长度（不含 \0），失败返回负数错误码
 */
int hustnet_encrypt_password(const char *password, char *out_hex, size_t out_hex_size);

/**
 * @brief 使用自定义公钥模数与指数加密密码。
 *
 * @param password      明文密码字符串
 * @param modulus_hex   公钥模数十六进制字符串
 * @param exponent_hex  公钥指数十六进制字符串（如 "10001"）
 * @param out_hex       接收加密结果的缓冲区
 * @param out_hex_size  输出缓冲区大小
 * @return int 成功返回输出长度，失败返回负数错误码
 */
int hustnet_encrypt_password_ex(
    const char *password,
    const char *modulus_hex,
    const char *exponent_hex,
    char *out_hex,
    size_t out_hex_size
);

/**
 * @brief 对字符串进行标准 URL 编码（RFC 3986 百分号编码）。
 *
 * @param src       源字符串
 * @param dst       目标缓冲区
 * @param dst_size  目标缓冲区大小
 * @return int 成功返回写入字符数（不含 \0），空间不足返回 HUSTNET_ERR_BUFFER_TOO_SMALL
 */
int hustnet_url_encode(const char *src, char *dst, size_t dst_size);

/**
 * @brief 构造用于 POST /eportal/InterFace.do?method=login 的表单数据。
 *
 * 构造的格式如下：
 * userId=<enc_user>&password=<enc_pwd>&service=<enc_srv>&queryString=<enc_query>&operatorPwd=&operatorUserId=&validcode=&passwordEncrypt=true
 *
 * @param username           校园网学号 / 账号
 * @param encrypted_password 已通过 hustnet_encrypt_password 加密得到的 hex 密码
 * @param query_string       校园网未认证时由 NAS 劫持下发的原始 query string（未 URL 编码的原串）
 * @param service            服务套餐名（可选，传入 NULL 或 "" 则为空）
 * @param out_body           输出表单缓冲区（推荐至少 1024 字节）
 * @param out_body_size      输出缓冲区大小
 * @return int 成功返回实际写入长度，失败返回负数错误码
 */
int hustnet_build_login_payload(
    const char *username,
    const char *encrypted_password,
    const char *query_string,
    const char *service,
    char *out_body,
    size_t out_body_size
);

#ifdef __cplusplus
}
#endif

#endif /* HUSTNET_MINIMAL_H */

/* ========================================================================= */
/*                              实现部分 (IMPLEMENTATION)                     */
/* ========================================================================= */

#ifdef HUSTNET_MINIMAL_C_IMPLEMENTATION

#include <string.h>

#define _HUSTNET_BN_LIMBS (HUSTNET_BN_MAX_BITS / 32)
#define _HUSTNET_BN_DBL_LIMBS (_HUSTNET_BN_LIMBS * 2)

typedef struct {
    uint32_t limbs[_HUSTNET_BN_LIMBS];
    int len;
} _hustnet_bn_t;

typedef struct {
    uint32_t limbs[_HUSTNET_BN_DBL_LIMBS];
    int len;
} _hustnet_bn_dbl_t;

static void _bn_zero(_hustnet_bn_t *a) {
    memset(a->limbs, 0, sizeof(a->limbs));
    a->len = 0;
}

static void _bn_dbl_zero(_hustnet_bn_dbl_t *a) {
    memset(a->limbs, 0, sizeof(a->limbs));
    a->len = 0;
}

static void _bn_normalize(_hustnet_bn_t *a) {
    int i = _HUSTNET_BN_LIMBS - 1;
    while (i >= 0 && a->limbs[i] == 0) i--;
    a->len = i + 1;
}

static void _bn_dbl_normalize(_hustnet_bn_dbl_t *a) {
    int i = _HUSTNET_BN_DBL_LIMBS - 1;
    while (i >= 0 && a->limbs[i] == 0) i--;
    a->len = i + 1;
}

static int _bn_dbl_cmp(const _hustnet_bn_dbl_t *a, const _hustnet_bn_dbl_t *b) {
    if (a->len != b->len) return a->len > b->len ? 1 : -1;
    for (int i = a->len - 1; i >= 0; i--) {
        if (a->limbs[i] != b->limbs[i]) return a->limbs[i] > b->limbs[i] ? 1 : -1;
    }
    return 0;
}

static int _hex_val(char c) {
    if (c >= '0' && c <= '9') return c - '0';
    if (c >= 'a' && c <= 'f') return c - 'a' + 10;
    if (c >= 'A' && c <= 'F') return c - 'A' + 10;
    return -1;
}

static int _bn_from_hex(_hustnet_bn_t *a, const char *hex) {
    _bn_zero(a);
    while (*hex == '0') hex++;
    size_t hex_len = strlen(hex);
    if (hex_len == 0) return 0;

    int limb_idx = 0;
    int shift = 0;
    uint32_t cur = 0;

    for (int i = (int)hex_len - 1; i >= 0; i--) {
        int v = _hex_val(hex[i]);
        if (v < 0) return HUSTNET_ERR_INVALID_HEX;
        cur |= ((uint32_t)v) << shift;
        shift += 4;
        if (shift == 32) {
            if (limb_idx >= _HUSTNET_BN_LIMBS) return HUSTNET_ERR_OVERFLOW;
            a->limbs[limb_idx++] = cur;
            cur = 0;
            shift = 0;
        }
    }
    if (shift > 0) {
        if (limb_idx >= _HUSTNET_BN_LIMBS) return HUSTNET_ERR_OVERFLOW;
        a->limbs[limb_idx++] = cur;
    }
    a->len = limb_idx;
    _bn_normalize(a);
    return 0;
}

/* 直接在 password 原字符串上做倒序索引映射，零栈开销 */
static int _bn_from_password_chunk(
    _hustnet_bn_t *a,
    const char *password,
    size_t pwd_len,
    size_t chunk_offset,
    int chunk_size
) {
    _bn_zero(a);
    int limb_idx = 0;
    int shift = 0;
    uint32_t cur = 0;

    for (int i = 0; i < chunk_size; i++) {
        size_t k = chunk_offset + (size_t)i;
        uint8_t byte_val = (k < pwd_len) ? (uint8_t)password[pwd_len - 1 - k] : 0;
        cur |= ((uint32_t)byte_val) << shift;
        shift += 8;
        if (shift == 32) {
            if (limb_idx >= _HUSTNET_BN_LIMBS) return HUSTNET_ERR_OVERFLOW;
            a->limbs[limb_idx++] = cur;
            cur = 0;
            shift = 0;
        }
    }
    if (shift > 0) {
        if (limb_idx >= _HUSTNET_BN_LIMBS) return HUSTNET_ERR_OVERFLOW;
        a->limbs[limb_idx++] = cur;
    }
    a->len = limb_idx;
    _bn_normalize(a);
    return 0;
}

/* 直接就地写入目标 buffer，零临时栈 buffer */
static int _bn_to_hex(const _hustnet_bn_t *a, char *out, size_t out_size) {
    if (a->len == 0) {
        if (out_size < 5) return HUSTNET_ERR_BUFFER_TOO_SMALL;
        memcpy(out, "0000", 5);
        return 4;
    }

    uint32_t top = a->limbs[a->len - 1];
    int top_hex_digits = 0;
    uint32_t tmp_top = top;
    while (tmp_top > 0) {
        top_hex_digits++;
        tmp_top >>= 4;
    }
    int raw_len = (a->len - 1) * 8 + top_hex_digits;
    int pad_len = ((raw_len + 3) / 4) * 4;
    int lead_zeros = pad_len - raw_len;

    if ((size_t)pad_len + 1 > out_size) return HUSTNET_ERR_BUFFER_TOO_SMALL;

    for (int i = 0; i < lead_zeros; i++) {
        out[i] = '0';
    }
    int pos = lead_zeros;
    static const char hex_digits[] = "0123456789abcdef";
    for (int i = top_hex_digits - 1; i >= 0; i--) {
        out[pos++] = hex_digits[(top >> (i * 4)) & 0x0F];
    }
    for (int l = a->len - 2; l >= 0; l--) {
        uint32_t val = a->limbs[l];
        for (int i = 7; i >= 0; i--) {
            out[pos++] = hex_digits[(val >> (i * 4)) & 0x0F];
        }
    }
    out[pad_len] = '\0';
    return pad_len;
}

static void _bn_dbl_sub(_hustnet_bn_dbl_t *r, const _hustnet_bn_dbl_t *a, const _hustnet_bn_dbl_t *b) {
    uint64_t borrow = 0;
    int max_len = a->len > b->len ? a->len : b->len;
    for (int i = 0; i < max_len; i++) {
        uint64_t ai = i < a->len ? a->limbs[i] : 0;
        uint64_t bi = i < b->len ? b->limbs[i] : 0;
        uint64_t diff = ai - bi - borrow;
        r->limbs[i] = (uint32_t)diff;
        borrow = (diff >> 32) & 1;
    }
    for (int i = max_len; i < _HUSTNET_BN_DBL_LIMBS; i++) {
        r->limbs[i] = 0;
    }
    r->len = max_len;
    _bn_dbl_normalize(r);
}

static void _bn_mul_to_dbl(_hustnet_bn_dbl_t *r, const _hustnet_bn_t *a, const _hustnet_bn_t *b) {
    _bn_dbl_zero(r);
    for (int i = 0; i < a->len; i++) {
        uint64_t carry = 0;
        for (int j = 0; j < b->len; j++) {
            int k = i + j;
            if (k >= _HUSTNET_BN_DBL_LIMBS) break;
            uint64_t sum = (uint64_t)a->limbs[i] * (uint64_t)b->limbs[j] + r->limbs[k] + carry;
            r->limbs[k] = (uint32_t)sum;
            carry = sum >> 32;
        }
        for (int k = i + b->len; carry > 0 && k < _HUSTNET_BN_DBL_LIMBS; k++) {
            uint64_t sum = (uint64_t)r->limbs[k] + carry;
            r->limbs[k] = (uint32_t)sum;
            carry = sum >> 32;
        }
    }
    _bn_dbl_normalize(r);
}

static int _bn_bit_length(const _hustnet_bn_t *a) {
    if (a->len == 0) return 0;
    int top_idx = a->len - 1;
    uint32_t v = a->limbs[top_idx];
    int bits = top_idx * 32;
    while (v > 0) {
        bits++;
        v >>= 1;
    }
    return bits;
}

static int _bn_dbl_bit_length(const _hustnet_bn_dbl_t *a) {
    if (a->len == 0) return 0;
    int top_idx = a->len - 1;
    uint32_t v = a->limbs[top_idx];
    int bits = top_idx * 32;
    while (v > 0) {
        bits++;
        v >>= 1;
    }
    return bits;
}

static void _bn_dbl_lshift_bits(_hustnet_bn_dbl_t *r, const _hustnet_bn_t *a, int shift) {
    if (a->len == 0 || shift == 0) {
        _bn_dbl_zero(r);
        for (int i = 0; i < a->len; i++) r->limbs[i] = a->limbs[i];
        r->len = a->len;
        return;
    }
    _bn_dbl_zero(r);
    int limb_shift = shift / 32;
    int bit_shift = shift % 32;

    uint32_t carry = 0;
    for (int i = 0; i < a->len; i++) {
        int target = i + limb_shift;
        if (target >= _HUSTNET_BN_DBL_LIMBS) break;
        uint64_t val = ((uint64_t)a->limbs[i] << bit_shift) | carry;
        r->limbs[target] = (uint32_t)val;
        carry = (uint32_t)(val >> 32);
    }
    int top = a->len + limb_shift;
    if (carry && top < _HUSTNET_BN_DBL_LIMBS) {
        r->limbs[top] = carry;
        top++;
    }
    r->len = top < _HUSTNET_BN_DBL_LIMBS ? top : _HUSTNET_BN_DBL_LIMBS;
    _bn_dbl_normalize(r);
}

static void _bn_dbl_rshift1(_hustnet_bn_dbl_t *a) {
    uint32_t carry = 0;
    for (int i = a->len - 1; i >= 0; i--) {
        uint32_t next_carry = (a->limbs[i] & 1) ? 0x80000000U : 0;
        a->limbs[i] = (a->limbs[i] >> 1) | carry;
        carry = next_carry;
    }
    _bn_dbl_normalize(a);
}

static void _bn_dbl_mod(_hustnet_bn_t *r, _hustnet_bn_dbl_t *a, const _hustnet_bn_t *m) {
    _bn_dbl_normalize(a);
    if (m->len == 0) {
        _bn_zero(r);
        return;
    }
    int m_bits = _bn_bit_length(m);
    int a_bits = _bn_dbl_bit_length(a);
    if (a_bits < m_bits) {
        _bn_zero(r);
        for (int i = 0; i < a->len && i < _HUSTNET_BN_LIMBS; i++) r->limbs[i] = a->limbs[i];
        r->len = a->len < _HUSTNET_BN_LIMBS ? a->len : _HUSTNET_BN_LIMBS;
        _bn_normalize(r);
        return;
    }

    _hustnet_bn_dbl_t shifted_m;
    int shift = a_bits - m_bits;
    _bn_dbl_lshift_bits(&shifted_m, m, shift);

    while (shift >= 0) {
        if (_bn_dbl_cmp(a, &shifted_m) >= 0) {
            _bn_dbl_sub(a, a, &shifted_m);
        }
        _bn_dbl_rshift1(&shifted_m);
        shift--;
    }

    _bn_zero(r);
    for (int i = 0; i < a->len && i < _HUSTNET_BN_LIMBS; i++) r->limbs[i] = a->limbs[i];
    r->len = a->len < _HUSTNET_BN_LIMBS ? a->len : _HUSTNET_BN_LIMBS;
    _bn_normalize(r);
}

static void _bn_mod_pow(
    _hustnet_bn_t *r,
    const _hustnet_bn_t *base,
    const _hustnet_bn_t *exp,
    const _hustnet_bn_t *mod
) {
    _hustnet_bn_t res;
    _bn_zero(&res);
    res.limbs[0] = 1;
    res.len = 1;

    _hustnet_bn_t b = *base;
    if (_bn_bit_length(&b) >= _bn_bit_length(mod)) {
        _hustnet_bn_dbl_t dbl_b;
        _bn_dbl_zero(&dbl_b);
        for (int i = 0; i < b.len; i++) dbl_b.limbs[i] = b.limbs[i];
        dbl_b.len = b.len;
        _bn_dbl_mod(&b, &dbl_b, mod);
    }

    int exp_bits = _bn_bit_length(exp);
    for (int i = 0; i < exp_bits; i++) {
        int limb_idx = i / 32;
        int bit_idx = i % 32;
        if ((exp->limbs[limb_idx] >> bit_idx) & 1) {
            _hustnet_bn_dbl_t tmp;
            _bn_mul_to_dbl(&tmp, &res, &b);
            _bn_dbl_mod(&res, &tmp, mod);
        }
        if (i + 1 < exp_bits) {
            _hustnet_bn_dbl_t tmp;
            _bn_mul_to_dbl(&tmp, &b, &b);
            _bn_dbl_mod(&b, &tmp, mod);
        }
    }
    *r = res;
}

static int _eportal_chunk_size(const char *modulus_hex) {
    while (*modulus_hex == '0') modulus_hex++;
    size_t len = strlen(modulus_hex);
    if (len == 0) len = 1;
    int digits = (int)((len + 3) / 4);
    if (digits < 1) digits = 1;
    return 2 * (digits - 1);
}

int hustnet_encrypt_password_ex(
    const char *password,
    const char *modulus_hex,
    const char *exponent_hex,
    char *out_hex,
    size_t out_hex_size
) {
    if (!password || !modulus_hex || !exponent_hex || !out_hex) {
        return HUSTNET_ERR_INVALID_PARAM;
    }

    int chunk_size = _eportal_chunk_size(modulus_hex);
    if (chunk_size <= 0) return HUSTNET_ERR_INVALID_PARAM;

    _hustnet_bn_t modulus, exponent;
    int err = _bn_from_hex(&modulus, modulus_hex);
    if (err != 0) return err;
    err = _bn_from_hex(&exponent, exponent_hex);
    if (err != 0) return err;

    size_t pwd_len = strlen(password);
    size_t total_chunks = (pwd_len + chunk_size - 1) / chunk_size;
    if (total_chunks == 0) total_chunks = 1;

    out_hex[0] = '\0';
    size_t total_out_len = 0;

    for (size_t c = 0; c < total_chunks; c++) {
        size_t offset = c * chunk_size;
        _hustnet_bn_t block;
        err = _bn_from_password_chunk(&block, password, pwd_len, offset, chunk_size);
        if (err != 0) return err;

        _hustnet_bn_t crypt;
        _bn_mod_pow(&crypt, &block, &exponent, &modulus);

        int chunk_hex_len = _bn_to_hex(&crypt, out_hex + total_out_len, out_hex_size - total_out_len);
        if (chunk_hex_len < 0) return chunk_hex_len;

        total_out_len += chunk_hex_len;
    }

    return (int)total_out_len;
}

int hustnet_encrypt_password(const char *password, char *out_hex, size_t out_hex_size) {
    return hustnet_encrypt_password_ex(
        password,
        HUSTNET_DEFAULT_MODULUS,
        HUSTNET_DEFAULT_EXPONENT,
        out_hex,
        out_hex_size
    );
}

int hustnet_url_encode(const char *src, char *dst, size_t dst_size) {
    if (!src || !dst || dst_size == 0) return HUSTNET_ERR_INVALID_PARAM;
    static const char hex_chars[] = "0123456789ABCDEF";
    size_t w = 0;
    for (size_t i = 0; src[i] != '\0'; i++) {
        unsigned char c = (unsigned char)src[i];
        if ((c >= 'a' && c <= 'z') ||
            (c >= 'A' && c <= 'Z') ||
            (c >= '0' && c <= '9') ||
            c == '-' || c == '_' || c == '.' || c == '~') {
            if (w + 1 >= dst_size) return HUSTNET_ERR_BUFFER_TOO_SMALL;
            dst[w++] = (char)c;
        } else {
            if (w + 3 >= dst_size) return HUSTNET_ERR_BUFFER_TOO_SMALL;
            dst[w++] = '%';
            dst[w++] = hex_chars[(c >> 4) & 0x0F];
            dst[w++] = hex_chars[c & 0x0F];
        }
    }
    dst[w] = '\0';
    return (int)w;
}

static int _append_buf(char *dst, size_t *w, size_t max, const char *src) {
    while (*src) {
        if (*w + 1 >= max) return HUSTNET_ERR_BUFFER_TOO_SMALL;
        dst[(*w)++] = *src++;
    }
    return HUSTNET_OK;
}

static int _append_urlencode(char *dst, size_t *w, size_t max, const char *src) {
    if (!src) return HUSTNET_OK;
    static const char hex_chars[] = "0123456789ABCDEF";
    while (*src) {
        unsigned char c = (unsigned char)*src++;
        if ((c >= 'a' && c <= 'z') ||
            (c >= 'A' && c <= 'Z') ||
            (c >= '0' && c <= '9') ||
            c == '-' || c == '_' || c == '.' || c == '~') {
            if (*w + 1 >= max) return HUSTNET_ERR_BUFFER_TOO_SMALL;
            dst[(*w)++] = (char)c;
        } else {
            if (*w + 3 >= max) return HUSTNET_ERR_BUFFER_TOO_SMALL;
            dst[(*w)++] = '%';
            dst[(*w)++] = hex_chars[(c >> 4) & 0x0F];
            dst[(*w)++] = hex_chars[c & 0x0F];
        }
    }
    return HUSTNET_OK;
}

int hustnet_build_login_payload(
    const char *username,
    const char *encrypted_password,
    const char *query_string,
    const char *service,
    char *out_body,
    size_t out_body_size
) {
    if (!username || !encrypted_password || !out_body || out_body_size == 0) {
        return HUSTNET_ERR_INVALID_PARAM;
    }
    size_t w = 0;
    if (_append_buf(out_body, &w, out_body_size, "userId=") != 0 ||
        _append_urlencode(out_body, &w, out_body_size, username) != 0 ||
        _append_buf(out_body, &w, out_body_size, "&password=") != 0 ||
        _append_buf(out_body, &w, out_body_size, encrypted_password) != 0 ||
        _append_buf(out_body, &w, out_body_size, "&service=") != 0 ||
        _append_urlencode(out_body, &w, out_body_size, service) != 0 ||
        _append_buf(out_body, &w, out_body_size, "&queryString=") != 0 ||
        _append_urlencode(out_body, &w, out_body_size, query_string) != 0 ||
        _append_buf(out_body, &w, out_body_size, "&operatorPwd=&operatorUserId=&validcode=&passwordEncrypt=true") != 0) {
        return HUSTNET_ERR_BUFFER_TOO_SMALL;
    }
    out_body[w] = '\0';
    return (int)w;
}

#endif /* HUSTNET_MINIMAL_C_IMPLEMENTATION */
