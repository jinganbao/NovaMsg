# NovaMsg

> 游戏前后端网络协议一键生成工具

NovaMsg 是一款基于 **Tauri 2 + Vue 3** 构建的桌面应用，专为游戏开发中的网络通信协议管理而设计。通过定义 XML 协议文件，自动生成 **Java（后端）** 和 **C#（前端/Unity）** 的协议代码，大幅减少手写重复代码的工作量，保证前后端协议一致性。

---

## ✨ 核心功能

### 📋 XML 协议定义

使用简洁的 XML 格式定义游戏网络协议，支持以下元素：

- **Module** — 模块（按功能划分，如登录、战斗、背包）
- **Message** — 消息（C2S / S2C / S2P / P2S 四种方向）
- **Struct** — 自定义对象结构（可嵌套引用）
- **Field** — 字段，支持基础类型（int、long、float、double、string、boolean、short、byte）和数组类型

示例 XML：

```xml
<?xml version="1.0" encoding="UTF-8"?>
<Module moduleName="login" desc="登录模块">
  <Struct name="LoginInfo" desc="登录信息">
    <Field type="string" name="Account" desc="账号"/>
    <Field type="string" name="Token" desc="令牌"/>
  </Struct>
  <Message name="C2S_Login" type="C2S" desc="登录请求">
    <Field type="string" name="Name" desc="用户名"/>
    <Field type="string" name="Password" desc="密码"/>
    <Field type="int" name="WebId" desc="平台ID"/>
  </Message>
  <Message name="S2C_AccountLoginSuccess" type="S2C" desc="登录成功">
    <Field type="int" name="ServerCurTime" desc="服务器时间"/>
    <Field type="int" name="ErrorCode" desc="错误码"/>
  </Message>
</Module>
```

### 🎨 双模式编辑

- **表单模式** — 可视化编辑模块、消息、结构体和字段，无需手写 XML
- **XML 模式** — 直接编辑 XML 源码，基于 CodeMirror 提供语法高亮，**双击消息名可快速跳转到表单模式对应位置**

### 🤖 代码自动生成

一键从 XML 协议文件生成以下代码：

| 目标 | 生成文件 | 说明 |
|------|---------|------|
| **C# (Unity/前端)** | `MessageBeans.cs` | 所有消息类与 Bean 类汇总（encode/decode） |
| | `MessagePool.cs` | 消息注册与反序列化 |
| **Java (后端)** | `XXX.java` | 每个 Struct 一个 Bean 类（write/read） |
| | `XXXMessage.java` | 每个 Message 一个实体类 |
| | `MessageId.java` | 所有消息 ID 常量和版本号汇总 |
| | `GameHandlerManager.java` | C2S / P2S 消息路由注册 |
| | `XXXHandler.java` | C2S 消息处理骨架（已存在则跳过） |

### 🔢 智能消息 ID 管理

- 基于 **SQLite** 持久化存储，按消息类型分区间自动分配 ID
- **同名消息 ID 保持不变**，即使重新生成也不会变动
- ID 区间分配：

| 类型 | ID 范围 |
|------|---------|
| S2P | 1000 ~ 4999 |
| P2S | 5000 ~ 9999 |
| C2S | 10000 ~ 19999 |
| S2C | 20000 ~ 29999 |

### ✅ 协议校验

生成前自动校验协议定义：

- **错误检查**：字段名/消息名/对象名重复、非法标识符、Java/C# 关键字冲突、引用不存在的对象类型
- **警告提示**：潜在的命名问题

### 👁️ 预览模式

生成前可**预览将生成的所有文件内容**，支持按文件名搜索和按内容搜索，确认无误后再写入磁盘。

### 🎯 更多特性

- 支持**暗色/亮色主题**切换，5 种主题色可选
- 支持 **Ctrl+S** 保存、**Ctrl+P** 预览、**Ctrl+Enter** 生成、**Ctrl+F** 搜索
- 未保存修改提醒，防止误操作丢失数据
- 右键菜单支持文件**重命名**和**删除**
- macOS 系统托盘支持，关闭窗口后可在 Dock 重新打开

---

## 🛠 技术栈

| 层级 | 技术 |
|------|------|
| 桌面框架 | [Tauri 2](https://tauri.app/) (Rust) |
| 前端 UI | [Vue 3](https://vuejs.org/) + [TypeScript](https://www.typescriptlang.org/) |
| UI 组件库 | [Naive UI](https://www.naiveui.com/) |
| 代码编辑器 | [CodeMirror 6](https://codemirror.net/) |
| 构建工具 | [Vite](https://vitejs.dev/) |
| 模板引擎 | [Handlebars](https://handlebarsjs.com/) |
| XML 解析 | [fast-xml-parser](https://github.com/NaturalIntelligence/fast-xml-parser) |
| 数据持久化 | SQLite (via rusqlite) |

---

## 🚀 快速开始

### 环境要求

- **Node.js** ≥ 18
- **Rust** ≥ 1.77.2（需要 `rustup` 工具链）
- **pnpm**（推荐）或 npm

### 安装依赖

```bash
# 安装前端依赖
pnpm install

# Tauri 依赖会在首次运行时自动安装
```

### 开发运行

```bash
pnpm tauri:dev
```

### 生产构建

```bash
pnpm tauri:build
```

构建产物位于 `src-tauri/target/release/bundle/`。

> **macOS 用户**：构建 `.dmg` 需要 Xcode Command Line Tools。

---

## 📖 使用指南

### 1. 配置路径

点击左侧「设置」按钮，配置三个目录：

- **XML 目录** — 存放 XML 协议文件的目录
- **后端消息目录** — Java 代码生成目标路径（通常是后端项目的消息包路径）
- **前端消息目录** — C# 代码生成目标路径（通常是 Unity 项目的消息脚本路径）

### 2. 创建 / 导入协议文件

- 点击「选择目录」加载已有的 XML 文件
- 点击「+ 新建」创建新的 XML 协议文件

### 3. 编辑协议

在表单模式下可视化添加/编辑模块、结构体、消息和字段；或切换到 XML 模式直接编辑源码。双击 XML 中的消息名可快速定位到表单对应位置。

### 4. 校验 → 预览 → 生成

1. 点击 **校验** 检查协议定义是否正确
2. 点击 **预览** 查看将要生成的文件内容
3. 确认无误后点击 **生成** 将代码写入目标目录

### 5. 集成到工程

生成的 Java 代码需要配合以下依赖使用：

- Netty `ByteBuf` 用于二进制读写
- Lombok 用于自动生成 getter/setter
- 项目自身的 `Message`、`Bean`、`MessageHandler` 基类

生成的 C# 代码需要配合：

- `ByteBuffer` 二进制缓冲区
- `IMessageRaw` 接口
- `MessageDictionary` 消息字典

---

## 📁 项目结构

```
NovaMsg/
├── src/                        # Vue 前端源码
│   ├── App.vue                 # 根组件（主题配置）
│   ├── AppContent.vue          # 主界面（编辑器/预览/生成逻辑）
│   ├── main.ts                 # 入口文件
│   ├── components/
│   │   └── MessageEditor.vue   # 消息表单编辑器组件
│   ├── composables/
│   │   └── useConfig.ts        # 配置持久化（localStorage）
│   ├── generator/              # 代码生成核心
│   │   ├── index.ts            # 导出汇总
│   │   ├── types.ts            # 类型定义
│   │   ├── templates.ts        # Handlebars 模板
│   │   ├── generateProtocols.ts # 主生成流程
│   │   ├── renderModel.ts      # 渲染模型构建
│   │   ├── typeMapper.ts       # 字段类型映射
│   │   ├── codeFormatter.ts    # 生成代码格式化
│   │   └── fsWrapper.ts        # 文件系统操作封装
│   └── utils/
│       ├── xmlParser.ts        # XML 解析
│       └── xmlSerializer.ts    # ModuleDef → XML 序列化
├── src-tauri/                  # Rust 后端
│   ├── src/
│   │   ├── main.rs             # Tauri 主入口
│   │   ├── lib.rs              # Tauri 命令（ID 管理/清空）
│   │   └── db.rs               # SQLite 消息 ID 存储
│   ├── Cargo.toml              # Rust 依赖配置
│   └── tauri.conf.json         # Tauri 应用配置
├── test/                       # 测试文件
│   ├── verify.ts               # 验证脚本
│   ├── sample.xml              # 示例 XML 协议
│   └── output/                 # 期望输出参考
├── package.json                # 前端依赖配置
├── vite.config.ts              # Vite 构建配置
└── tsconfig.json               # TypeScript 配置
```

---

## ⚠️ 注意事项

- **Handler 文件保护**：Java Handler 文件（`XXXHandler.java`）如果已存在则**自动跳过**，不会覆盖业务逻辑代码。
- **消息 ID 不可手动配置**：XML 中的 `id` 属性会被忽略，消息 ID 由内置的 SQLite 分配器统一管理。
- **对象引用必须存在**：在 Field 中使用自定义 Struct 类型时，该 Struct 必须在同一个 XML 文件中定义。
- **协议文件必须在 XML 目录内**：新建/重命名/删除操作均在配置的 XML 目录下进行。

---

## 📝 License

MIT

---

## 👤 作者

Sunshine

> 🤖 部分代码由 [Claude Code](https://claude.ai/code) 辅助生成
