# GOHO University Web

GOHO University 产品与在线硬件工具的第一版静态网页原型。

## 当前内容

- 产品入口页：U Modules、VST Plugins、Small Software、Web Tools
- WebUSB 授权设备列表、固件文件选择、STM32 DfuSe DFU 烧录
- Web Serial 授权 CDC/串口设备列表、Start/Stop、TXT/HEX 接收与发送、LF/CRLF 行尾

> DFU 当前按项目现有 `dfu-util -a 0 -s 0x08000000:leave -D ...` 流程实现：支持 STM32 DfuSe 接口、Flash 擦除、分块写入、HEX 地址记录和完成后重启。实际硬件仍需连接测试；如果设备不是 STM32 DfuSe，需要单独适配协议。

## 本地预览

```bash
cd GOHO_Web
python3 -m http.server 4173
```

然后打开 <http://localhost:4173>。Web Serial/WebUSB 需要 HTTPS 或 localhost，并且主要支持 Chromium 系浏览器。
