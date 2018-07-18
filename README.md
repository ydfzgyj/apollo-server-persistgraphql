# 在 Apollo Server 中直接使用持久化查询

[![npm](https://img.shields.io/npm/v/apollo-server-persistgraphql.svg)](https://www.npmjs.com/package/apollo-server-persistgraphql)
![travis](https://img.shields.io/travis/ydfzgyj/apollo-server-persistgraphql.svg)
![coverage](https://img.shields.io/coveralls/github/ydfzgyj/apollo-server-persistgraphql.svg)

## 概述

GraphQL 能够让前端精准的获取所需的数据，但与此相伴的问题是需要在查询字符串中列出所有需要查询的字段，可能会导致查询请求过长，造成性能瓶颈。

Apollo 为解决这一问题提出了 [PersistGraphQL](https://github.com/apollographql/persistgraphql) 这一方案，为查询分配 ID 或 Hash，使客户端发送查询时只需要发送对应的 ID/Hash，从而实现压缩查询字符串长度的目的。

在 PersistGraphQL 的基础上，Apollo 又进一步推出了 [apollo-link-persisted-queries](https://github.com/apollographql/apollo-link-persisted-queries)，省去了 PersistGraphQL 的构建步骤，可以将服务端找不到的查询也动态的分配 Hash 值并加入到可用的查询列表中。但目前 apollo-link-persisted-queries 必须搭配 [Apollo Engine](https://www.apollographql.com/engine) 使用，而 Apollo Engine 被墙，在中国国内使用不便。

本库的目的是让无法使用 Apollo Engine 的用户也能够获得 GraphQL 持久化查询带来的好处，用户只需要对使用了 Apollo Server 的代码稍做修改即可。

**注意：目前本库只支持 Apollo Server v1.x + Express/Koa 框架。**

## 安装

```bash
npm install --save apollo-server-persistgraphql
```

## 使用

客户端直接使用 [apollo-link-persisted-queries](https://github.com/apollographql/apollo-link-persisted-queries) 即可。

服务端使用 Koa 的完整示例如下：

```js
import Koa from 'koa'
import KoaRouter from 'koa-router'
import bodyParser from 'koa-bodyparser'
import { graphqlKoa } from 'apollo-server-koa'
import { PersistedGraphQL } from 'apollo-server-persistgraphql'
import schema from './schema.js'

const app = new Koa()
const router = new KoaRouter()
app.use(bodyParser())

const persistedGraphQL = new PersistedGraphQL()
const persistedOptions = ctx => persistedGraphQL.transform(
  // 用户之前的 Apollo Server 配置
  { schema: schema },
  // persistedGraphQL 配置
  { koa: ctx }
)
router.post('/graphql', graphqlKoa(persistedOptions))

app.use(router.routes())
app.use(router.allowedMethods())
app.listen(3000)
```

使用 Express 的完整示例如下：

```js
import express from 'express'
import bodyParser from 'body-parser'
import { graphqlExpress } from 'apollo-server-express'
import { PersistedGraphQL } from 'apollo-server-persistgraphql'
import schema from './schema.js'

const app = express()

const persistedGraphQL = new PersistedGraphQL()
const persistedOptions = req => persistedGraphQL.transform(
  // 用户之前的 Apollo Server 配置
  { schema: schema },
  // persistedGraphQL 配置
  { express: req }
)
app.use('/graphql', bodyParser.json(), graphqlExpress(persistedOptions))
app.listen({ port: 3000 })
```

### 配置项

- `koa`: 当使用 Koa 时，传入 Koa 的 context
- `express`: 当使用 Express 时，传入 Express 的 request
- `onlyWhiteList`: 是否只允许白名单中的查询请求，以下详述

其中，`koa` 和 `express` 应至少传入一个

### 白名单

当用户的查询第一次发送到服务端时，由于无法找到对应的 Hash，会返回 `PersistedQueryNotFound` 错误，而 apollo-link-persisted-queries 发送附带 Hash 值的查询，使服务器端将查询加入缓存中。在本库中，用户可以将以 `.graphql` 文件形式存储的查询加入缓存，以减少一次请求的开销。

```js
// 加入一个 .graphql 查询
persistedGraphQL.addQueryFiles(process.cwd() + '/test/test.graphql')

// 加入一个文件夹下的所有 .graphql 查询
persistedGraphQL.addQueryFiles(process.cwd() + '/test/')
```

当用户加入查询到可用列表后，可以选择开启白名单模式，禁止可用列表之外的查询。
```js
// 开启白名单模式
const persistedOptions = ctx => persistedGraphQL.transform(
  { schema: schema },
  {
    koa: ctx,
    onlyWhiteList: true
  }
)

// 对不同请求采用不同的模式
const persistedOptions = ctx => persistedGraphQL.transform(
  { schema: schema },
  {
    koa: ctx,
    // 对管理员不启用白名单
    onlyWhiteList: ctx.state.user !== 'admin'
  }
)
```

开启白名单模式后，当查询不在可用列表中时，会返回以下错误：
```
{
  errors: [
    { message: 'PersistedQueryNotAllowed' }
  ]
}
```

### 绑定 schema

由于本库需要在用户的 schema 上添加专用的报错信息，用户需要将 schema 进行转换并绑定。
```js
// 在实例化 PersistedGraphQL 时，可以初始化绑定 schema
const persistedGraphQL = new PersistedGraphQL(schema)

// 在转换 Apollo Server 配置时，可以传入 schema
// 当已经传入过 schema 时，这里传入的 schema 会被忽略
const persistedOptions = ctx => persistedGraphQL.transform(
  { schema: schema },
  { koa: ctx }
)

// 可以使用此方法手动传入 schema
// 这里传入的 schema 将会覆盖之前的 schema
persistedGraphQL.updateSchema(schema)
```

### 防冲突配置

为了防止本库绑定在 schema 上的报错信息字段名与用户自定义的字段名产生冲突，可以在实例化 PersistedGraphQL 时传入报错信息使用的字段名。

```js
// 在第二个参数传入自定义的报错字段名，默认为 PersistedQueryError
const persistedGraphQL = new PersistedGraphQL(schema, 'CustomPersistedQueryError')
```
