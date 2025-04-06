# FileMaker Data API MCP Server

FileMaker Data API を Model Context Protocol（MCP）に対応させるサーバー実装です。FileMaker データベースへのアクセスを提供します。

## 機能

- トークンベースの認証管理
- レイアウトメタデータの取得
- レコードの検索機能

## Tools

- **get_token**

  - FileMaker Data API のトークンを取得
  - 入力:
    - 認証情報は環境変数から自動的に取得

- **abandon_token**

  - FileMaker Data API のトークンを破棄
  - 入力:
    - `token` (string): 破棄するトークン

- **get_layout_metadata**

  - レイアウトのメタデータを取得
  - 入力:
    - `token` (string): 有効なアクセストークン

- **find_records**
  - データベースのレコードを検索
  - 入力:
    - `token` (string): 有効なアクセストークン
    - `fieldName` (string): 検索対象のフィールド名
    - `searchText` (string): 検索テキスト

## インストール

```bash
npm install
```

## ビルド

```bash
npm run build
```

## 設定

### 環境変数の設定

以下の環境変数を設定する必要があります：

- `FILEMAKER_SERVER`: FileMaker サーバーのホスト名
- `FILEMAKER_DATABASE`: データベース名(ファイル名)
- `FILEMAKER_USERNAME`: ユーザー名
- `FILEMAKER_PASSWORD`: パスワード

### クライアントアプリでの使用方法：例としてclaude_desktop

`claude_desktop_config.json`に以下を記述して追加：

```json
{
  "mcpServers": {
    "filemaker": {
      "command": "node",
      "args": ["</ABSOLUTE/PATH/TO/>filemaker/build/index.js"],
      "env": {
        "FILEMAKER_SERVER": "your-server-host",
        "FILEMAKER_DATABASE": "your-database",
        "FILEMAKER_LAYOUT": "target-layout",
        "FILEMAKER_USERNAME": "your-username",
        "FILEMAKER_PASSWORD": "your-password"
      }
    }
  }
}
```

## 依存関係

- Node.js
- TypeScript
- @modelcontextprotocol/sdk: ^1.8.0
- zod: ^3.24.2

## ライセンス

ISC

## 注意事項

- FileMaker Server が稼働している必要があります
- FileMaker Data API が有効化されている必要があります
- 適切な認証情報（ユーザー名、パスワード）が必要です
- API アクセスに必要な権限が付与されている必要があります
