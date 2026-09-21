# 管理员活动操作日志

活动创建和永久删除会写入服务器本地 JSONL 文件，不通过管理网页提供读取接口。每行是一条独立 JSON 记录，包含 UTC 时间、动作、阶段、管理员用户名、活动编号和活动名称，不包含密码。

Docker Compose 默认把文件写到容器内 `/app/data/admin-operations.jsonl`，并通过命名卷 `festival_hub_operation_logs` 持久化。更新或重建应用容器不会删除该卷。

服务器管理员可以查看最近记录：

```sh
docker compose --env-file .env -f compose.production.yaml exec app tail -n 100 /app/data/admin-operations.jsonl
```

`authorized` 表示密码或管理员会话已经通过校验、服务器准备执行操作；`completed` 表示数据库操作已经完成。如果只有 `authorized` 而没有对应的 `completed`，应结合容器日志检查当时是否发生数据库错误。

不要把日志卷公开给网页服务器，也不要把日志文件提交到 Git。
