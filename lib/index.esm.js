import crypto from 'crypto'
import fs from 'fs'
import { mergeSchemas, makeExecutableSchema } from 'graphql-tools'
import { parse, print } from 'graphql/language'
import path from 'path'

/**
 * 获取变量的类型
 * @param {*} value
 * @returns {string}
 */
function getType (value) {
  return ({}).toString.call(value).toLowerCase().slice(8, -1)
}

export class PersistedGraphQL {
  /**
   * @param {GraphQLSchema} [schema] - 用户原始的 schema
   * @param {string} [errorType=PersistedQueryError] - 报错信息使用的类型名称
   */
  constructor (schema, errorType) {
    this.errorType = errorType || 'PersistedQueryError'
    // 可用查询
    this._availableQueries = {}
    if (schema) {
      this.updateSchema(schema)
    }
  }

  /**
   * 将报错专用的 Schema 合并到用户原始的 Schema 中
   * 以确保错误信息在 GraphQL 体系中返回
   * @param {GraphQLSchema} schema - 用户原始的 schema
   * @returns {GraphQLSchema}
   */
  updateSchema (schema) {
    if (!schema || schema.constructor.name !== 'GraphQLSchema') {
      throw new Error('You must pass a valid GraphQL schema.')
    }
    const errorSchema = {
      typeDefs: [
        `type Query { ${this.errorType}(err: String!): String }`
      ],
      resolvers: {
        Query: {}
      }
    }
    errorSchema.resolvers.Query[this.errorType] = (root, { err }) => err
    this.schema = mergeSchemas({
      schemas: [
        schema,
        makeExecutableSchema(errorSchema)
      ]
    })
  }

  /**
   * 添加查询到白名单
   * @param {string} filePath - 文件路径或所在目录
   */
  addQueryFiles (filePath) {
    const stats = fs.statSync(filePath)
    if (stats.isDirectory()) {
      const files = fs.readdirSync(filePath)
      for (let fileName of files) {
        const fullName = path.join(filePath, fileName)
        this.addQueryFiles(fullName)
      }
    } else if (path.parse(filePath).ext === '.graphql') {
      const content = fs.readFileSync(filePath, 'utf-8')
      const gql = print(parse(content))
      const hash = crypto.createHash('sha256').update(gql).digest('hex')
      this._availableQueries[hash] = gql
    } else if (path.parse(filePath).ext === '.json') {
      const json = JSON.parse(fs.readFileSync(filePath, 'utf-8'))
      Object.keys(json).forEach(content => {
        const gql = print(parse(content))
        const hash = crypto.createHash('sha256').update(gql).digest('hex')
        this._availableQueries[hash] = gql
      })
    }
  }

  /**
   * 返回可进行持久化查询的 Apollo Server 选项
   * @param {object} apolloOptions - 用户原来的 Apollo Server 选项
   * @param {object} options
   * @param {KoaContext} [options.koa] - Koa 的 ctx
   * @param {ExpressRequest} [options.express] - Express 的 req，以上两项必须且只能有一项
   * @param {boolean} [options.onlyWhiteList] - 只允许白名单中的请求
   * @returns {object}
   */
  transform (apolloOptions, options) {
    let body
    if (!options) {
      throw new Error('You must pass one server instance.')
    }
    if (options.koa) {
      const ctx = options.koa
      body = ctx.request.method === 'POST' ? ctx.request.body : ctx.request.query
    } else if (options.express) {
      const req = options.express
      body = req.method === 'POST' ? req.body : req.query
    } else {
      throw new Error('You must pass one server instance.')
    }
    if (!this.schema) {
      this.updateSchema(apolloOptions.schema)
    }
    apolloOptions.schema = this.schema
    this._transformPersisted(body, options.onlyWhiteList)
    apolloOptions.formatResponse = this._formatResponse(apolloOptions.formatResponse)
    return apolloOptions
  }

  /**
   * 处理接收到的 GraphQL 请求体
   * @param {object|object[]} body
   * @param {boolean} [onlyWhiteList=false]
   */
  _transformPersisted (body, onlyWhiteList = false) {
    if (getType(body) === 'array') {
      body.forEach(query => this._transformPersisted(query, onlyWhiteList))
      return
    } else if (body.extensions) {
      let extensions = body.extensions
      if (getType(extensions) === 'string') {
        try {
          extensions = JSON.parse(extensions)
        } catch (e) {
          // 什么也不做，让 Apollo Server 报错
          return
        }
      }
      if (extensions.persistedQuery) {
        const hash = extensions.persistedQuery.sha256Hash
        if (this._availableQueries[hash]) {
          body.query = this._availableQueries[hash]
          return
        } else if (!onlyWhiteList) {
          if (body.query) {
            this._availableQueries[hash] = body.query
          } else {
            body.query = `query { ${this.errorType}(err: "PersistedQueryNotFound") }`
          }
        }
      }
    }
    if (onlyWhiteList) {
      body.query = `query { ${this.errorType}(err: "PersistedQueryNotAllowed") }`
    }
  }

  /**
   * 截获返回的响应体，检查是否存在我们设置的报错内容
   * @param {function} originalFunction - 用户原始的 formatResponse 函数
   * @returns {object}
   */
  _formatResponse (originalFunction) {
    return rsp => {
      if (rsp.data[this.errorType]) {
        return {
          errors: [
            { message: rsp.data[this.errorType] }
          ]
        }
      } else if (originalFunction) {
        return originalFunction(rsp)
      } else {
        return rsp
      }
    }
  }
}
