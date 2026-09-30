# HUST CAS 验证码自动识别（油猴脚本）

在 `https://pass.hust.edu.cn/cas/login` 打开后自动拉取验证码 GIF，**在浏览器本地离线识别**（算法即 `../stdchar`，数据不出浏览器），填入验证码框；账号密码已被浏览器/密码管理器填好且把握足够时可自动点击登录。

## 安装

1. 安装 Tampermonkey / Violentmonkey。
2. 新建脚本，把 [`hust-cas-captcha.user.js`](./hust-cas-captcha.user.js) 的全部内容粘进去保存（或在浏览器里打开该文件的 raw 地址，扩展会提示安装）。

## 行为

- 打开登录页 → 约 0.1 秒内填好验证码，验证码图片同步换成识别所用的那一张。
- 点击验证码图片 → 重新拉取并识别（服务器只认最近一次请求的验证码，所以显示与识别用同一份字节）。
- **把握度**：每位数字取「次优距离 − 最优距离」，任一位低于 `MIN_MARGIN`(40) 就静默换一张重试，最多 4 张（拉验证码不算登录尝试）；仍拿不准则填入但**不自动登录**，右下角提示你确认。
- **自动登录**（油猴菜单可开关，默认开）：仅当账号密码已被填好、把握足够、页面没有错误提示时点击登录；**两分钟内最多自动登录一次**——登录失败页面重载后不会再自动提交，避免错密码/识别错误反复触发账号锁定（CAS：连续失败 5 次锁 1 分钟，之后请求一律 403）。

## 开发

```bash
node hustpass/userscript/build.mjs   # src/ → hust-cas-captcha.user.js
```

`src/recognizer.js` 是不依赖 DOM 的纯函数（`recognizeGif(arrayBuffer)`），与 `stdchar` 逐张对拍一致（20/20）。
模板取自 `../stdchar/char_*.npy`，遵循 LGPL-3.0-or-later（见 `../stdchar/NOTICE`）。
