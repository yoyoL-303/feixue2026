/*
 * 独立 PNG 资源管理器
 * ------------------------------------------------------------
 * 数据源：assets/asset-manifest.js 中的 window.GAME_ASSET_MANIFEST
 * 特点：
 *  - 纯前端、无第三方依赖、兼容 file:// 直接打开
 *  - 预加载所有 PNG，失败时静默降级，不影响游戏继续运行
 *  - 暴露 getPath / getImage / getStatus / getStats 等统一接口
 *  - 不修改 DOM，不参与游戏逻辑，方便后续替换正式美术
 */
(function (global) {
  "use strict";

  class GameResourceManager {
    constructor(manifest, options) {
      this.manifest = manifest && typeof manifest === "object" ? manifest : { assets: {} };
      this.options = Object.assign(
        { basePath: "assets/", timeout: 12000 },
        options || {}
      );
      this.basePath = String(this.options.basePath || this.manifest.basePath || "assets/");
      if (!this.basePath.endsWith("/")) this.basePath += "/";

      this.entries = new Map();
      const assets = this.manifest.assets || {};
      Object.keys(assets).forEach((id) => {
        const def = assets[id];
        if (!def || !def.src) return;
        this.entries.set(id, Object.assign({ id }, def));
      });

      this.records = new Map();
      this.stats = {
        total: this.entries.size,
        loaded: 0,
        failed: 0,
        pending: 0
      };
      this.ready = false;
      this._preloadPromise = null;
    }

    _resolvePath(src) {
      if (!src) return "";
      if (/^(?:[a-z][a-z0-9+.-]*:)?\/\//i.test(src)) return src;
      if (/^(?:data:|blob:|file:|\/)/i.test(src)) return src;
      if (/^[A-Za-z]:[\\/]/.test(src)) return src;
      return this.basePath + src.replace(/^\.\//, "");
    }

    getPath(id) {
      const def = this.entries.get(id);
      return def ? this._resolvePath(def.src) : "";
    }

    getConfig(id) {
      const def = this.entries.get(id);
      return def ? Object.assign({}, def) : null;
    }

    getStatus(id) {
      const record = this.records.get(id);
      return record ? record.status : "idle";
    }

    isReady(id) {
      return this.getStatus(id) === "loaded";
    }

    getImage(id) {
      const record = this.records.get(id);
      return record && record.status === "loaded" ? record.image : null;
    }

    getStats() {
      const statuses = {};
      this.entries.forEach((def, id) => {
        statuses[id] = this.getStatus(id);
      });
      return {
        total: this.stats.total,
        loaded: this.stats.loaded,
        failed: this.stats.failed,
        pending: this.stats.pending,
        ready: this.ready,
        statuses
      };
    }

    load(id) {
      const def = this.entries.get(id);
      if (!def) return Promise.resolve(null);

      const existing = this.records.get(id);
      if (existing) return existing.promise;

      const record = {
        status: "loading",
        image: null,
        error: null,
        promise: null
      };

      record.promise = new Promise((resolve) => {
        const image = new Image();
        let settled = false;

        const finish = (ok, error) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          record.status = ok ? "loaded" : "failed";
          record.image = ok ? image : null;
          record.error = error || null;
          if (ok) this.stats.loaded += 1;
          else this.stats.failed += 1;
          resolve(ok ? image : null);
        };

        const timer = setTimeout(() => finish(false, "timeout"), this.options.timeout);
        image.decoding = "async";
        image.onload = () => finish(true, null);
        image.onerror = () => finish(false, "load-error");
        image.src = this.getPath(id);
      });

      this.records.set(id, record);
      return record.promise;
    }

    preloadAll() {
      if (this._preloadPromise) return this._preloadPromise;
      const ids = [];
      this.entries.forEach((def, id) => {
        if (def.preload !== false) ids.push(id);
      });
      this.stats.pending = ids.length;
      this._preloadPromise = Promise.all(ids.map((id) => this.load(id))).then(() => {
        this.stats.pending = 0;
        this.ready = true;
        return this.getStats();
      });
      return this._preloadPromise;
    }
  }

  global.GameResourceManager = GameResourceManager;
})(window);
