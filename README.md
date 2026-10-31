# GOHO University Web

GOHO University 产品与在线硬件工具的第一版静态网页原型。

## 当前内容

- 产品入口页：U Modules、VST Plugins、Small Software、Web Tools
- WebUSB 授权设备列表与设备选择入口：为后续 DFU 协议接入预留
- Web Serial 授权 CDC/串口设备列表、连接、接收日志、发送文本

## 本地预览

```bash
cd GOHO_Web
python3 -m http.server 4173
```

然后打开 <http://localhost:4173>。Web Serial/WebUSB 需要 HTTPS 或 localhost，并且主要支持 Chromium 系浏览器。
