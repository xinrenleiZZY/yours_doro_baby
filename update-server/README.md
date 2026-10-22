# 局域网更新源（Docker）

把 `electron-builder` 打出来的安装包目录通过 HTTP 暴露给局域网内的桌面端，供 `electron-updater` 自动更新。

- 端口：`9400`
- 更新地址：`http://<宿主机 IP>:9400/updates`
- 默认地址与 `package.json` 的 `build.publish` 一致：`http://192.168.0.193:9400/updates`

## 启动

```bash
# 在项目根目录先打包，生成 release/ 目录
npm run dist

# 启动更新服务
cd update-server
docker compose up -d --build
```

容器把宿主机的 `../release` 只读挂载到 `/usr/share/nginx/html/updates`，重新打包后无需重启容器。

## 验证

浏览器或命令行访问：

```bash
curl http://192.168.0.193:9400/updates/latest.yml
```

能看到 `version:` 与安装包文件名即表示更新源可用。

## 发布新版本

1. 修改 `package.json` 的 `version`（例如 `0.2.0` → `0.2.1`）。
2. 执行 `npm run dist` 重新打包。
3. 客户端每天 08:00 自动检查一次；也可以在托盘菜单点「检查更新」立即检查。
4. 发现新版本后，托盘会显示「发现新版本 vX，点击更新」，点击即自动下载并安装；也可以在配置中心点「立即检查更新」。

## 说明

- `release/` 中必须同时存在 `latest.yml` 与对应版本的安装包，`electron-builder` 会自动生成。
- 桌面端首次安装仍需手动分发一次安装包；之后的升级走更新源。
- 开发模式（`npm start`）不会真正检查更新，配置中心会显示「开发模式（打包后可用）」。
