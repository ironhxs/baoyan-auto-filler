# 数据库 Schema

## 存储分层

| 存储 | 内容 | 理由 |
|------|------|------|
| `chrome.storage.local` | API 配置 | 数据量小，与现有代码兼容 |
| IndexedDB `autoFillerDB` | 个人信息 | 支持 Blob、索引查询、大容量 |

---

## chrome.storage.local — API 配置

```ts
interface ApiConfig {
  baseUrl: string;   // 默认 "https://api.openai.com/v1"
  apiKey: string;
  model: string;     // 必填，不设置默认模型
  apiMode: 'chat_completions' | 'responses';
  fastMode: boolean; // 默认 false
}
```

---

## IndexedDB: `autoFillerDB` v1

### `textFields` — 键值文本字段

keyPath: `id` (autoIncrement)

```ts
interface TextField {
  id?: number;    // 自增主键
  key: string;    // 用户自定义 key，如 "银行卡号"
  value: string;  // 用户自定义 value，如 "6222..."
}
```

### `fileRecords` — 文件记录

keyPath: `id` (autoIncrement)
索引: `fileType`, `createdAt`

```ts
interface FileRecord {
  id?: number;              // 自增主键
  filename: string;         // 原始文件名
  fileType: string;         // 文件类型
  fileBody: Blob;           // 文件体（Blob 原生存储，无编码开销）
  fileSize: number;         // 文件大小 (bytes)
  fileDescription: string;  // 文件描述
  createdAt: number;        // 创建时间戳
}
```

**fileType 枚举：**

```
pdf, docx, doc, md, txt, xlsx, xls, pptx, ppt, csv,
jpg, jpeg, png, gif, bmp, webp, html, json
```
