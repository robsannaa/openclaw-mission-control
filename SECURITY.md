# 安全政策 (Security Policy)

## 支援的版本
目前僅針對 `main` 分支提供安全更新。

## 回報漏洞
如果你發現任何安全性漏洞，請不要公開發佈 Issue。請透過以下方式私下聯繫：
- 透過 GitHub 私人回報功能 (Private Vulnerability Reporting)
- [在此處填寫你的聯繫 Email]

## 專案安全聲明
本專案作為 OpenClaw 的控制面板，具有讀取本地檔案（如 .env, SOUL.md）與監控系統之權限。建議使用者：
1. 僅在受信任的區域網路執行。
2. 使用強大的 Bearer Token 進行身份驗證。
3. 避免將此服務直接暴露於公網。
