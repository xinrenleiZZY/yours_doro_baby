# doro 局域网好友服务

## 启动

```powershell
docker compose up -d --build
```

服务监听 `9500`，健康检查 `http://<局域网IP>:9500/health`。数据持久化到 `./data/social.json`。

## API

- `POST /api/register`：创建游戏 ID 和访问令牌
- `POST /api/recover`：使用游戏 ID + 恢复码换取新令牌
- `GET /api/directory?q=`：搜索昵称或游戏 ID
- `GET /api/social`：读取个人资料、好友和申请
- `PUT /api/profile`：更新昵称 / 简介 / 头像
- `POST /api/friends/request`：发送好友申请
- `POST /api/friends/respond`：接受或拒绝申请
- `DELETE /api/friends/:gameId`：删除好友
- `GET /api/conversations`：读取好友私聊、群聊会话、最后一条消息和未读数
- `GET /api/messages?kind=direct|group&targetId=...`：读取会话最近 200 条消息并标记已读
- `POST /api/messages`：发送私聊或群聊文本消息
- `POST /api/groups`：创建群组并邀请自己的好友
- `PUT /api/groups/:groupId`：群主修改群名称
- `POST /api/groups/:groupId/members`：群主邀请自己的好友入群
- `DELETE /api/groups/:groupId/members/:gameId`：群主移出成员
- `POST /api/groups/:groupId/leave`：退出群组；群主退出时自动转让给首位成员
- `DELETE /api/groups/:groupId`：群主解散群组并清理群聊记录
- `POST /api/presence`：更新在线状态
- `POST /api/recovery/issue`：为尚未签发恢复码的旧身份生成恢复码
- `GET /api/shop/catalog`：读取 Docker 商城目录
- `POST /api/shop/entitlements`：合并永久购买与租赁到期时间
- `POST /api/leaderboard/sync`：同步等级、家具、时装、典藏四类聚合分数
- `GET /api/leaderboards`：读取 Top 50、自己的排名、上期榜一和已获得限定典藏

除注册、目录搜索、商城目录和健康检查外，请求都需要 `X-Doro-Token`。令牌只在本机保存，服务端存储 SHA-256 哈希。

## 聊天与群组

私聊只对当前好友开放；群组支持最多 50 名成员，群主只能邀请自己的好友。消息长度上限 500 字，每个会话保留最近 200 条，服务端总计最多 20,000 条；同一玩家 10 秒最多发送 15 条，超出返回 `rate-limited`。所有会话读写都会校验好友或群成员身份，客户端每 4 秒轮询一次会话，不依赖公网 WebSocket。

`GET /api/messages` 会同时推进当前用户的已读时间；`GET /api/conversations` 返回 `unread` 计数。被移出群组或删除好友后，下一次请求会立即失去对应会话访问权限。消息正文会清理控制字符和 HTML 标签，并按纯文本渲染。

## 商城目录

`shop-catalog.json` 支持动态新增商品、调整价格 / 积分 / 加成和上下架状态。当前目录版本为 `2026.10.23.1`，包含 26 件云端家具、20 款叠层装扮和 24 件典藏覆盖项。Compose 会将该文件只读挂载进容器，修改后下一次 `GET /api/shop/catalog` 会按文件更新时间自动重载，不需要重新打包桌面客户端。

商品权益按游戏 ID 存储在 `data/social.json`，永久权益只增不减，租赁时间取本地和云端更晚者。恢复码同样只存哈希，使用后会轮换。

排行榜按 `Asia/Shanghai` 自然日结算，每日 00:00 为四榜第一名发放对应限定典藏。服务端每 15 秒惰性检查跨日，离线玩家按最后一次同步的分数参与；重复夺冠不会重复发放同一件典藏。榜一在下一自然日获得「永耀」：对应榜单有效分数 +20%，到再下一次 00:00 自动失效。等级榜王冠另有永久产出 +5% 和当日产出 +100%；家具、时装、典藏榜的当日产出为 +200%。
