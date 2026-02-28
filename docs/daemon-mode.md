# 守护进程模式 (Daemon Mode)

PIweb 支持守护进程模式，可以在后台自动执行定时任务。

## 快速开始

### 1. 启用守护进程

编辑 `daemon.config.json`：

```json
{
  "enabled": true,
  "tasks": [
    {
      "id": "daily-greeting",
      "name": "每日问候",
      "schedule": "0 8 * * *",
      "enabled": true,
      "prompt": "早上好！今天是{date}，请帮我总结一下今天的工作计划。",
      "session": "daily-tasks"
    }
  ],
  "settings": {
    "autoCreateSession": true,
    "saveToMemory": true,
    "notifyOnComplete": false
  }
}
```

### 2. 启动守护进程

```bash
npm run daemon
```

或者直接使用：

```bash
piweb --daemon
```

## Cron 表达式格式

```
* * * * *
│ │ │ │ │
│ │ │ │ └─ 星期 (0-7, 0 和 7 都是周日)
│ │ │ └─── 月份 (1-12)
│ │ └───── 日期 (1-31)
│ └─────── 小时 (0-23)
└───────── 分钟 (0-59)
```

### 常用示例

- `0 8 * * *` - 每天早上 8 点
- `0 * * * *` - 每小时整点
- `*/30 * * * *` - 每 30 分钟
- `0 9 * * 1-5` - 工作日早上 9 点
- `0 0 * * 0` - 每周日凌晨

## 变量替换

在 prompt 中可以使用以下变量：

- `{date}` - 当前日期（如：2026/02/22）
- `{time}` - 当前时间（如：15:30:00）
- `{weekday}` - 星期几（如：周一）

## 配置说明

### Task 配置

| 字段 | 类型 | 说明 |
|------|------|------|
| id | string | 任务唯一标识 |
| name | string | 任务名称 |
| schedule | string | Cron 表达式 |
| enabled | boolean | 是否启用 |
| prompt | string | 发送给 AI 的提示词 |
| session | string | 会话名称（可选） |

### Settings 配置

| 字段 | 类型 | 说明 |
|------|------|------|
| autoCreateSession | boolean | 自动创建新会话 |
| saveToMemory | boolean | 保存结果到记忆 |
| notifyOnComplete | boolean | 完成后通知（暂未实现） |

## 手机息屏问题说明

**为什么之前会停止工作：**

1. 前端依赖：AI 任务需要前端触发才能执行
2. WebSocket 断开：手机息屏后 WiFi 进入低功耗模式，连接断开

**解决方案：**

现在使用守护进程模式后：
- 任务在后端独立运行，不依赖前端
- 使用 Cron 定时触发，无需前端
- 手机息屏不影响后台任务执行

## 注意事项

1. 守护进程需要 Node.js 持续运行
2. 确保 `daemon.config.json` 中 `enabled: true`
3. 任务执行日志会输出到控制台
4. 按 `Ctrl+C` 可停止守护进程
