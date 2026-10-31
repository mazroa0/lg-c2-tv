/*!
 * محرّك عرض صغير مستقل — بديل عن محرّك لوحة التصميم.
 * يدعم ما تحتاجه صفحات الواجهة فقط: {{المتغيرات}} و <sc-for> و <sc-if>
 * ومعالجات الأحداث، مع ترقيع DOM بدل إعادة بنائه حتى لا يفقد الإدخال
 * تركيزه ولا تُستأنف حركة أوراق الخريف من بدايتها كل ثانية.
 */
(function (global) {
  'use strict';

  /* ---------- الأساس الذي ترث منه مكوّنات الصفحات ---------- */

  function DCLogic(props) {
    this.props = props || {};
    this.state = {};
  }

  DCLogic.prototype.setState = function (patch) {
    var next = typeof patch === 'function' ? patch(this.state) : patch;
    var key;
    for (key in next) {
      if (Object.prototype.hasOwnProperty.call(next, key)) this.state[key] = next[key];
    }
    this.forceUpdate();
  };

  DCLogic.prototype.forceUpdate = function () {
    if (this.__render) this.__render();
  };

  /* ---------- قراءة القيم من نطاق العرض ---------- */

  function resolve(expr, scope) {
    var text = String(expr == null ? '' : expr);
    var whole = text.match(/^\{\{([\s\S]+)\}\}$/);
    var path = (whole ? whole[1] : text).trim();
    if (path === 'true') return true;
    if (path === 'false') return false;
    if (path === 'null') return null;
    var parts = path.split('.');
    var value = scope;
    for (var i = 0; i < parts.length; i++) {
      if (value == null) return undefined;
      value = value[parts[i]];
    }
    return value;
  }

  function interpolate(text, scope) {
    if (typeof text !== 'string' || text.indexOf('{{') === -1) return text;
    if (/^\{\{[^{}]+\}\}$/.test(text)) return resolve(text, scope);
    return text.replace(/\{\{([^{}]+)\}\}/g, function (_, inner) {
      var value = resolve('{{' + inner + '}}', scope);
      return value == null ? '' : String(value);
    });
  }

  /* ---------- بناء شجرة جديدة من القالب ---------- */

  function buildChildren(templateNode, scope) {
    var out = [];
    var nodes = templateNode.childNodes;

    for (var i = 0; i < nodes.length; i++) {
      var node = nodes[i];

      if (node.nodeType === 3) {
        out.push(document.createTextNode(interpolate(node.data, scope)));
        continue;
      }
      if (node.nodeType !== 1) continue;

      var tag = node.tagName.toLowerCase();

      if (tag === 'sc-for') {
        var list = resolve(node.getAttribute('list'), scope) || [];
        var alias = node.getAttribute('as') || 'item';
        for (var j = 0; j < list.length; j++) {
          var inner = Object.create(scope);
          inner[alias] = list[j];
          inner[alias + '_index'] = j;
          push(out, buildChildren(node, inner));
        }
        continue;
      }

      if (tag === 'sc-if') {
        if (resolve(node.getAttribute('value'), scope)) push(out, buildChildren(node, scope));
        continue;
      }

      var el = node.cloneNode(false);
      var attrs = node.attributes;

      for (var a = 0; a < attrs.length; a++) {
        var name = attrs[a].name;
        var raw = attrs[a].value;

        if (name.indexOf('hint-placeholder') === 0) {
          el.removeAttribute(name);
          continue;
        }

        if (/^on[a-z]/i.test(name)) {
          var fn = resolve(raw, scope);
          el.removeAttribute(name);
          if (typeof fn === 'function') {
            if (!el.__handlers) el.__handlers = {};
            el.__handlers[name.slice(2).toLowerCase()] = fn;
          }
          continue;
        }

        var value = interpolate(raw, scope);
        if (value === false || value === null || value === undefined) el.removeAttribute(name);
        else if (value === true) el.setAttribute(name, '');
        else el.setAttribute(name, String(value));
      }

      push(el, buildChildren(node, scope), true);
      out.push(el);
    }

    return out;
  }

  function push(target, items, asChildren) {
    for (var i = 0; i < items.length; i++) {
      if (asChildren) target.appendChild(items[i]);
      else target.push(items[i]);
    }
  }

  /* ---------- ربط المستمعين مرة واحدة لكل عنصر ---------- */

  function bindEvents(el) {
    if (el.nodeType !== 1 || !el.__handlers) return;
    if (!el.__bound) el.__bound = {};
    for (var type in el.__handlers) {
      if (el.__bound[type]) continue;
      el.__bound[type] = true;
      (function (node, kind) {
        node.addEventListener(kind, function (ev) {
          var fn = node.__handlers && node.__handlers[kind];
          if (fn) fn(ev);
        });
      })(el, type);
    }
  }

  function bindTree(node) {
    if (node.nodeType !== 1) return;
    bindEvents(node);
    for (var i = 0; i < node.childNodes.length; i++) bindTree(node.childNodes[i]);
  }

  /* ---------- ترقيع الشجرة الحيّة بدل استبدالها ---------- */

  function patch(live, next) {
    if (live.nodeType !== next.nodeType || (live.nodeType === 1 && live.tagName !== next.tagName)) {
      live.parentNode.replaceChild(next, live);
      bindTree(next);
      return;
    }

    if (live.nodeType === 3) {
      if (live.data !== next.data) live.data = next.data;
      return;
    }
    if (live.nodeType !== 1) return;

    var i;
    for (i = 0; i < next.attributes.length; i++) {
      var attr = next.attributes[i];
      if (live.getAttribute(attr.name) !== attr.value) live.setAttribute(attr.name, attr.value);
    }
    for (i = live.attributes.length - 1; i >= 0; i--) {
      var name = live.attributes[i].name;
      if (!next.hasAttribute(name)) live.removeAttribute(name);
    }

    live.__handlers = next.__handlers || null;
    bindEvents(live);

    var liveKids = [];
    var nextKids = [];
    for (i = 0; i < live.childNodes.length; i++) liveKids.push(live.childNodes[i]);
    for (i = 0; i < next.childNodes.length; i++) nextKids.push(next.childNodes[i]);

    var max = Math.max(liveKids.length, nextKids.length);
    for (i = 0; i < max; i++) {
      if (i < liveKids.length && i < nextKids.length) patch(liveKids[i], nextKids[i]);
      else if (i >= liveKids.length) {
        bindTree(nextKids[i]);
        live.appendChild(nextKids[i]);
      } else {
        live.removeChild(liveKids[i]);
      }
    }
  }

  /* ---------- ملاءمة التصميم (١٩٢٠×١٠٨٠) لأي شاشة ---------- */

  function fitStage(stage) {
    function apply() {
      var scale = Math.min(window.innerWidth / 1920, window.innerHeight / 1080);
      stage.style.transform = 'scale(' + scale + ')';
    }
    apply();
    window.addEventListener('resize', apply);
  }

  /* ---------- التنقل بأسهم الريموت بين الصفحات ---------- */

  function remoteNav(root) {
    document.addEventListener('keydown', function (ev) {
      if (ev.key !== 'ArrowLeft' && ev.key !== 'ArrowRight') return;
      var active = document.activeElement;
      if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')) return;

      var links = root.querySelectorAll('a[href]');
      var want = ev.key === 'ArrowLeft' ? 'left' : 'right';
      for (var i = 0; i < links.length; i++) {
        var box = links[i].getBoundingClientRect();
        var atLeft = box.left < 80;
        var atRight = box.right > window.innerWidth - 80;
        if ((want === 'left' && atLeft && !atRight) || (want === 'right' && atRight && !atLeft)) {
          if (box.height > 120) {
            ev.preventDefault();
            window.location.href = links[i].getAttribute('href');
            return;
          }
        }
      }
    });
  }

  /* ---------- التركيب ---------- */

  function mount(ComponentClass, props) {
    var template = document.getElementById('dc-template');
    var root = document.getElementById('dc-root');
    var stage = document.getElementById('dc-stage');
    var instance = new ComponentClass(props || {});

    instance.__render = function () {
      var values = instance.renderVals();
      var fresh = buildChildren(template.content, values);

      if (!root.firstChild) {
        for (var i = 0; i < fresh.length; i++) {
          bindTree(fresh[i]);
          root.appendChild(fresh[i]);
        }
        return;
      }

      var liveKids = [];
      for (var k = 0; k < root.childNodes.length; k++) liveKids.push(root.childNodes[k]);
      var max = Math.max(liveKids.length, fresh.length);
      for (var j = 0; j < max; j++) {
        if (j < liveKids.length && j < fresh.length) patch(liveKids[j], fresh[j]);
        else if (j >= liveKids.length) {
          bindTree(fresh[j]);
          root.appendChild(fresh[j]);
        } else {
          root.removeChild(liveKids[j]);
        }
      }
    };

    instance.__render();
    if (instance.componentDidMount) instance.componentDidMount();
    window.addEventListener('pagehide', function () {
      if (instance.componentWillUnmount) instance.componentWillUnmount();
    });

    if (stage) fitStage(stage);
    remoteNav(root);

    global.__dc = instance;
    return instance;
  }

  global.DCLogic = DCLogic;
  global.mountDC = mount;
})(window);
