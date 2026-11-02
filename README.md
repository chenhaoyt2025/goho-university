# GOHO University Web

GOHO University 产品与在线硬件工具的第一版静态网页原型。

## 当前内容

- 产品入口页：U Modules、VST Plugins、Small Software、Web Tools
- WebUSB 授权设备列表、BIN/HEX 固件文件选择、STM32 DfuSe DFU 烧录
- GOHO UPDATE 虚拟磁盘烧录：首次绑定一次固定卷标 `GOHO UPDATE`；之后一键自动寻找 GOHO CDC、发送 `XXX`，并自动连接虚拟磁盘；可提前选择或拖入 application-only `.BIN`
- Web Serial 授权 CDC/串口设备列表、Start/Stop、TXT/HEX 接收与发送、LF/CRLF 行尾
- Web Audio USB 声卡监听：检测输入通道数，使用互斥的 MONO / STEREO 通道滚轮选择；选择后自动监听，默认音量 33%，支持 Mute；单声道复制到电脑左右两个默认扬声器，双声道分别送到左右扬声器

> DFU 当前按项目现有 `dfu-util -a 0 -s 0x08000000:leave -D ...` 流程实现：支持 STM32 DfuSe 接口、Flash 擦除、分块写入、HEX 地址记录和完成后重启。实际硬件仍需连接测试；如果设备不是 STM32 DfuSe，需要单独适配协议。

> 虚拟磁盘对应 `bootloader_no_wav/usb_msc_official.cc`：卷标是 `GOHO UPDATE`，FAT12 RAM disk 总容量 512 KiB，根目录用 `UPDATE.BIN` 写入；bootloader 接受任意 `.BIN` 但随后按 application vector table 校验，因此 bootloader + application combo 应继续使用 DFU，不要拖进虚拟磁盘。浏览器安全策略不允许网页枚举所有系统磁盘，所以首次仍需手动绑定一次；绑定句柄会保存在浏览器本地。

## 本地预览

```bash
cd GOHO_Web
python3 -m http.server 4173
```

然后打开 <http://localhost:4173>。Web Serial/WebUSB 需要 HTTPS 或 localhost，并且主要支持 Chromium 系浏览器。
