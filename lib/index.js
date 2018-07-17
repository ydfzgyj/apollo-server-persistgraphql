"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.PersistedGraphQL = void 0;

var _crypto = _interopRequireDefault(require("crypto"));

var _fs = _interopRequireDefault(require("fs"));

var _graphqlTools = require("graphql-tools");

var _language = require("graphql/language");

var _path = _interopRequireDefault(require("path"));

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

/**
 * 获取变量的类型
 * @param {*} value
 * @returns {string}
 */
function getType(value) {
  return {}.toString.call(value).toLowerCase().slice(8, -1);
}

class PersistedGraphQL {
  /**
   * @param {GraphQLSchema} [schema] - 用户原始的 schema
   * @param {string} [errorType=PersistedQueryError] - 报错信息使用的类型名称
   */
  constructor(schema, errorType) {
    this.errorType = errorType || 'PersistedQueryError'; // 可用查询

    this._availableQueries = {};

    if (schema) {
      this.updateSchema(schema);
    }
  }
  /**
   * 将报错专用的 Schema 合并到用户原始的 Schema 中
   * 以确保错误信息在 GraphQL 体系中返回
   * @param {GraphQLSchema} schema - 用户原始的 schema
   * @returns {GraphQLSchema}
   */


  updateSchema(schema) {
    if (!schema || schema.constructor.name !== 'GraphQLSchema') {
      throw new Error('You must pass a valid GraphQL schema.');
    }

    const errorSchema = {
      typeDefs: [`type Query { ${this.errorType}(err: String!): String }`],
      resolvers: {
        Query: {}
      }
    };

    errorSchema.resolvers.Query[this.errorType] = (root, {
      err
    }) => err;

    this.schema = (0, _graphqlTools.mergeSchemas)({
      schemas: [schema, (0, _graphqlTools.makeExecutableSchema)(errorSchema)]
    });
  }
  /**
   * 添加查询到白名单
   * @param {string} filePath - 文件路径或所在目录
   */


  addQueryFiles(filePath) {
    const stats = _fs.default.statSync(filePath);

    if (stats.isDirectory()) {
      const files = _fs.default.readdirSync(filePath);

      var _iteratorNormalCompletion = true;
      var _didIteratorError = false;
      var _iteratorError = undefined;

      try {
        for (var _iterator = files[Symbol.iterator](), _step; !(_iteratorNormalCompletion = (_step = _iterator.next()).done); _iteratorNormalCompletion = true) {
          let fileName = _step.value;

          const fullName = _path.default.join(filePath, fileName);

          this.addQueryFiles(fullName);
        }
      } catch (err) {
        _didIteratorError = true;
        _iteratorError = err;
      } finally {
        try {
          if (!_iteratorNormalCompletion && _iterator.return != null) {
            _iterator.return();
          }
        } finally {
          if (_didIteratorError) {
            throw _iteratorError;
          }
        }
      }
    } else if (_path.default.parse(filePath).ext === '.graphql') {
      const content = _fs.default.readFileSync(filePath, 'utf-8');

      const hash = _crypto.default.createHash('sha256').update((0, _language.print)((0, _language.parse)(content))).digest('hex');

      this._availableQueries[hash] = content;
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


  transform(apolloOptions, options) {
    let body;

    if (!options) {
      throw new Error('You must pass one server instance.');
    }

    if (options.koa) {
      const ctx = options.koa;
      body = ctx.request.method === 'POST' ? ctx.request.body : ctx.request.query;
    } else if (options.express) {
      const req = options.express;
      body = req.method === 'POST' ? req.body : req.query;
    } else {
      throw new Error('You must pass one server instance.');
    }

    if (!this.schema) {
      this.updateSchema(apolloOptions.schema);
    }

    apolloOptions.schema = this.schema;

    this._transformPersisted(body, options.onlyWhiteList);

    apolloOptions.formatResponse = this._formatResponse(apolloOptions.formatResponse);
    return apolloOptions;
  }
  /**
   * 处理接收到的 GraphQL 请求体
   * @param {object|object[]} body
   * @param {boolean} [onlyWhiteList=false]
   */


  _transformPersisted(body, onlyWhiteList = false) {
    if (getType(body) === 'array') {
      body.forEach(query => this._transformPersisted(query, onlyWhiteList));
      return;
    } else if (body.extensions) {
      let extensions = body.extensions;

      if (getType(extensions) === 'string') {
        try {
          extensions = JSON.parse(extensions);
        } catch (e) {
          // 什么也不做，让 Apollo Server 报错
          return;
        }
      }

      if (extensions.persistedQuery) {
        const hash = extensions.persistedQuery.sha256Hash;

        if (this._availableQueries[hash]) {
          body.query = this._availableQueries[hash];
          return;
        } else if (!onlyWhiteList) {
          if (body.query) {
            this._availableQueries[hash] = body.query;
          } else {
            body.query = `query { ${this.errorType}(err: "PersistedQueryNotFound") }`;
          }
        }
      }
    }

    if (onlyWhiteList) {
      body.query = `query { ${this.errorType}(err: "PersistedQueryNotAllowed") }`;
    }
  }
  /**
   * 截获返回的响应体，检查是否存在我们设置的报错内容
   * @param {function} originalFunction - 用户原始的 formatResponse 函数
   * @returns {object}
   */


  _formatResponse(originalFunction) {
    return rsp => {
      if (rsp.data[this.errorType]) {
        return {
          errors: [{
            message: rsp.data[this.errorType]
          }]
        };
      } else if (originalFunction) {
        return originalFunction(rsp);
      } else {
        return rsp;
      }
    };
  }

}

exports.PersistedGraphQL = PersistedGraphQL;
