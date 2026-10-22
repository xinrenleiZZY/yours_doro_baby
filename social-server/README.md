# doro 局域网好友服务

## 启动

```powershell
docker compose up -d --build
```

服务监听 `9500`，健康检查 `http://<局域网IP>:9500/health`。数据持久化到 `./data/social.json`。

## API

- `POST /api/register`：创建游戏 ID 和访问令牌
- `GET /api/directory?q=`：搜索昵称或游戏 ID
- `GET /api/social`：读取个人资料、好友和申请
- `PUT /api/profile`：更新昵称 / 简介 / 头像
- `POST /api/friends/request`：发送好友申请
- `POST /api/friends/respond`：接受或拒绝申请
- `DELETE /api/friends/:gameId`：删除好友
- `POST /api/presence`：更新在线状态

除注册、搜索和健康检查外，请求都需要 `X-Doro-Token`。令牌只在本机保存，服务端存储 SHA-256 哈希。
