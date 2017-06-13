define([
    'jquery',
    '/bower_components/marked/marked.min.js',
    '/common/cryptpad-common.js',
    '/common/media-tag.js',
    '/bower_components/diff-dom/diffDOM.js',
    '/bower_components/tweetnacl/nacl-fast.min.js',
],function ($, Marked, Cryptpad, MediaTag) {
    var DiffMd = {};

    var DiffDOM = window.diffDOM;
    var renderer = new Marked.Renderer();

    Marked.setOptions({
        renderer: renderer
    });

    DiffMd.render = function (md) {
        return Marked(md);
    };

    // Tasks list
    var checkedTaskItemPtn = /^\s*\[x\]\s*/;
    var uncheckedTaskItemPtn = /^\s*\[ \]\s*/;
    renderer.listitem = function (text) {
        var isCheckedTaskItem = checkedTaskItemPtn.test(text);
        var isUncheckedTaskItem = uncheckedTaskItemPtn.test(text);
        if (isCheckedTaskItem) {
            text = text.replace(checkedTaskItemPtn,
                '<i class="fa fa-check-square" aria-hidden="true"></i>&nbsp;') + '\n';
        }
        if (isUncheckedTaskItem) {
            text = text.replace(uncheckedTaskItemPtn,
                '<i class="fa fa-square-o" aria-hidden="true"></i>&nbsp;') + '\n';
        }
        var cls = (isCheckedTaskItem || isUncheckedTaskItem) ? ' class="todo-list-item"' : '';
        return '<li'+ cls + '>' + text + '</li>\n';
    };
    renderer.image = function (href, title, text) {
        if (href.slice(0,6) === '/file/') {
            var parsed = Cryptpad.parsePadUrl(href);
            var hexFileName = Cryptpad.base64ToHex(parsed.hashData.channel);
            var mt = '<media-tag src="/blob/' + hexFileName.slice(0,2) + '/' + hexFileName + '" data-crypto-key="cryptpad:' + parsed.hashData.key + '"></media-tag>';
            return mt;
        }
        var out = '<img src="' + href + '" alt="' + text + '"';
        if (title) {
            out += ' title="' + title + '"';
        }
        out += this.options.xhtml ? '/>' : '>';
        return out;
    };

    var forbiddenTags = [
        'SCRIPT',
        'IFRAME',
        'OBJECT',
        'APPLET',
        'VIDEO',
        'AUDIO',
    ];
    var unsafeTag = function (info) {
        if (['addAttribute', 'modifyAttribute'].indexOf(info.diff.action) !== -1) {
            if (/^on/.test(info.diff.name)) {
                console.log("Rejecting forbidden element attribute with name", info.diff.name);
                return true;
            }
        }
        if (['addElement', 'replaceElement'].indexOf(info.diff.action) !== -1) {
            var msg = "Rejecting forbidden tag of type (%s)";
            if (info.diff.element && forbiddenTags.indexOf(info.diff.element.nodeName) !== -1) {
                console.log(msg, info.diff.element.nodeName);
                return true;
            } else if (info.diff.newValue && forbiddenTags.indexOf(info.diff.newValue.nodeName) !== -1) {
                console.log("Replacing restricted element type (%s) with PRE", info.diff.newValue.nodeName);
                info.diff.newValue.nodeName = 'PRE';
            }
        }
    };

    var getSubMediaTag = function (element) {
        var result = [];
        console.log(element);
        if (element.nodeName === "MEDIA-TAG") {
            result.push(element);
            return result;
        }
        if (element.childNodes) {
            element.childNodes.forEach(function (el) {
                result = result.concat(getSubMediaTag(el, result));
            });
        }
        console.log(result);
        return result;
    };
    var mediaTag = function (info) {
        if (info.diff.action === 'addElement') {
            return getSubMediaTag(info.diff.element);
            //MediaTag.CryptoFilter.setAllowedMediaTypes(allowedMediaTypes);
            //MediaTag($mt[0]);
        }
        return;
    };

    var slice = function (coll) {
        return Array.prototype.slice.call(coll);
    };

    /*  remove listeners from the DOM */
    var removeListeners = function (root) {
        slice(root.attributes).map(function (attr) {
            if (/^on/.test(attr.name)) {
                root.attributes.removeNamedItem(attr.name);
            }
        });
        // all the way down
        slice(root.children).forEach(removeListeners);
    };

    var domFromHTML = function (html) {
        var Dom = new DOMParser().parseFromString(html, "text/html");
        removeListeners(Dom.body);
        return Dom;
    };

    //var toTransform = [];
    var DD = new DiffDOM({
        preDiffApply: function (info) {
            if (unsafeTag(info)) { return true; }
            //var mt = mediaTag(info);
            //console.log(mt);
            //if (mt) { toTransform = toTransform.concat(mt); }
        },
        postDiffApply: function () {
            /*while (toTransform.length) {
                var el = toTransform.pop();
                console.log(el);
                MediaTag(el);
            }*/
        }
    });

    var makeDiff = function (A, B, id) {
        var Err;
        var Els = [A, B].map(function (frag) {
            if (typeof(frag) === 'object') {
                if (!frag || (frag && !frag.body)) {
                    Err = "No body";
                    return;
                }
                var els = frag.body.querySelectorAll('#'+id);
                if (els.length) {
                    return els[0];
                }
            }
            Err = 'No candidate found';
        });
        if (Err) { return Err; }
        var patch = DD.diff(Els[0], Els[1]);
        return patch;
    };

    DiffMd.apply = function (newHtml, $content) {
        var id = $content.attr('id');
        if (!id) { throw new Error("The element must have a valid id"); }
        var $div = $('<div>', {id: id}).append(newHtml);
        var Dom = domFromHTML($('<div>').append($div).html());
        var oldDom = domFromHTML($content[0].outerHTML);
        var patch = makeDiff(oldDom, Dom, id);
        if (typeof(patch) === 'string') {
            throw new Error(patch);
        } else {
            DD.apply($content[0], patch);
            var $mts = $content.find('media-tag:not(:has(*))');
            $mts.each(function (i, el) {
                console.log(el);
                var allowedMediaTypes = [
                    'image/png',
                    'image/jpeg',
                    'image/jpg',
                    'image/gif',
                    'audio/mp3',
                    'audio/ogg',
                    'audio/wav',
                    'audio/webm',
                    'video/mp4',
                    'video/ogg',
                    'video/webm',
                    'application/pdf',
                    'application/dash+xml',
                    'download'
                ];

                MediaTag.CryptoFilter.setAllowedMediaTypes(allowedMediaTypes);
                MediaTag(el);
            });
        }
    };

    return DiffMd;
});

