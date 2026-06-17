# Render 部署说明

## 方式一：使用 render.yaml

1. 把本目录 `D:\德州扑克牌小游戏` 上传到一个 GitHub 仓库。
2. 打开 Render Dashboard。
3. 选择 New > Blueprint。
4. 连接这个 GitHub 仓库。
5. Render 会读取仓库根目录的 `render.yaml` 并创建 Web Service。
6. 部署完成后，打开 Render 提供的 `https://你的服务名.onrender.com` 地址。

## 方式二：手动创建 Web Service

1. 在 Render Dashboard 选择 New > Web Service。
2. 连接 GitHub 仓库。
3. Runtime / Language 选择 Node。
4. Build Command 填：

```bash
npm install
```

5. Start Command 填：

```bash
npm start
```

6. Health Check Path 填：

```text
/healthz
```

## 使用方式

部署成功后：

1. 打开 Render 生成的网址。
2. 输入昵称，创建房间。
3. 点击复制链接，把链接发给朋友。
4. 朋友打开链接加入房间。
5. 2 到 4 人到齐后，由房主点击左上角开始按钮。

## 注意

免费实例可能会在无人访问时休眠。第一次打开可能需要等待几十秒，房间状态也保存在服务内存里，服务重启后房间会清空。
