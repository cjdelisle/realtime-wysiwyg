define([
    'RTFrontend_errorbox',
    'RTFrontend_toolbar',
    'RTFrontend_realtime_input',
    'RTFrontend_hyperjson',
    'RTFrontend_hyperscript',
    'RTFrontend_cursor',
    'RTFrontend_json_ot',
    'RTFrontend_userdata',
    'RTFrontend_tests',
    'json.sortify',
    'RTFrontend_text_patcher',
    'RTFrontend_interface',
    'RTFrontend_saver',
    'RTFrontend_chainpad',
    'RTFrontend_diffDOM',
    'jquery'
], function (ErrorBox, Toolbar, realtimeInput, Hyperjson, Hyperscript, Cursor, JsonOT, UserData, TypingTest, JSONSortify, TextPatcher, Interface, Saver, Chainpad) {
    var $ = window.jQuery;
    var DiffDom = window.diffDOM;

    /* REALTIME_DEBUG exposes a 'version' attribute.
        this must be updated with every release */
    var REALTIME_DEBUG = window.REALTIME_DEBUG = {
        version: '1.17',
        local: {},
        remote: {},
        Hyperscript: Hyperscript,
        Hyperjson: Hyperjson
    };
    var wiki = encodeURIComponent(XWiki.currentWiki);
    var space = encodeURIComponent(XWiki.currentSpace);
    var page = encodeURIComponent(XWiki.currentPage);

    // Create a fake "Crypto" object which will be passed to realtime-input
    var Crypto = {
        encrypt : function(msg, key) { return msg; },
        decrypt : function(msg, key) { return msg; },
        parseKey : function(key) { return {cryptKey : ''}; }
    }

    var stringify = function (obj) {
        return JSONSortify(obj);
    };

    window.Toolbar = Toolbar;
    window.Hyperjson = Hyperjson;

    var hjsonToDom = function (H) {
        return Hyperjson.callOn(H, Hyperscript);
    };

    var module = window.REALTIME_MODULE = {
        Hyperjson: Hyperjson,
        Hyperscript: Hyperscript
    };

    var uid = function () {
        return 'rtwiki-uid-' + String(Math.random()).substring(2);
    };

    // Filter elements to serialize
    var isMacroStuff = function (el) {
        var isMac = ( typeof el.getAttribute === "function" &&
                      ( el.getAttribute('data-cke-hidden-sel') ||
                        ( el.tagName === 'SPAN' && el.getAttribute('class') &&
                          el.getAttribute('class').split(' ').indexOf('cke_widget_drag_handler_container') !== -1 ) ) );
        //if (isMac) { console.log("Prevent serialize macro stuff", el); }
        return isMac;
    };
    var isNonRealtime = function (el) {
        return (typeof el.getAttribute === "function" &&
                el.getAttribute('class') &&
                el.getAttribute('class').split(" ").indexOf("rt-non-realtime") !== -1);
    };
    var shouldSerialize = function (el) {
        return !isNonRealtime(el) && !isMacroStuff(el);
    };

    // Filter attributes in the serialized elements
    var macroFilter = function (hj) {
        // Send a widget ID == 0 to avoid a fight between broswers about it and
        // prevent the container from having the "selected" class (blue border)
        if (hj[1].class &&
                hj[1].class.split(' ').indexOf('cke_widget_wrapper') !== -1 &&
                hj[1].class.split(' ').indexOf('cke_widget_block') !== -1) {
            hj[1].class = "cke_widget_wrapper cke_widget_block";
            hj[1]['data-cke-widget-id'] = "0";
        }
        if (hj[1].class &&
                hj[1].class.split(' ').indexOf('cke_widget_wrapper') !== -1 &&
                hj[1].class.split(' ').indexOf('cke_widget_inline') !== -1) {
            hj[1].class = "cke_widget_wrapper cke_widget_inline";
            hj[1]['data-cke-widget-id'] = "0";
        }
        // Don't send the "upcasted" attribute which can be removed, generating a shjson != shjson2 error
        if (hj[1].class && hj[1]['data-macro'] &&
                hj[1].class.split(' ').indexOf('macro') !== -1) {
            hj[1]['data-cke-widget-upcasted'] = undefined;
        }
        return hj;
    };
    var bodyFilter = function (hj) {
        if (hj[0] === "BODY#body") {
            hj[1].style = undefined;
            if (hj[1].contenteditable) { hj[1].contenteditable = "false"; }
        }
        return hj;
    }
    /* catch `type="_moz"` and body's inline style before it goes over the wire */
    var brFilter = function (hj) {
        if (hj[1].type === '_moz') { hj[1].type = undefined; }
        return hj;
    };
    // Replace all hex colors in style attributes by their rgb equivalent to match with hjsonToDom
    var colorFilter = function (hj) {
        if (hj[1] && hj[1].style) {
            var crtStyle = hj[1].style;
            var rgbHex = /#([0-9A-F][0-9A-F])([0-9A-F][0-9A-F])([0-9A-F][0-9A-F])/gi;
            hj[1].style = crtStyle.replace(rgbHex, function (m, r, g, b) {
                return 'rgb(' + parseInt(r,16) + ', '
                    + parseInt(g,16) + ', '
                    + parseInt(b,16) + ')';
            }).trim();
        }
        return hj;
    };
    var hjFilter = function (hj) {
        hj = brFilter(hj);
        hj = bodyFilter(hj);
        hj = macroFilter(hj);
        hj = colorFilter(hj);
        return hj;
    }

    var stringifyDOM = window.stringifyDOM = function (dom) {
        return stringify(Hyperjson.fromDOM(dom, shouldSerialize, hjFilter));
    };

    var main = module.main = function (editorConfig, docKeys) {

        var WebsocketURL = editorConfig.WebsocketURL;
        var htmlConverterUrl = editorConfig.htmlConverterUrl;
        var userName = editorConfig.userName;
        var DEMO_MODE = editorConfig.DEMO_MODE;
        var language = editorConfig.language;
        var userAvatar = editorConfig.userAvatarURL;
        var saverConfig = editorConfig.saverConfig || {};
        saverConfig.chainpad = Chainpad;
        saverConfig.editorType = 'rtwysiwyg';
        saverConfig.editorName = 'Wysiwyg';
        saverConfig.isHTML = true;
        saverConfig.mergeContent = true;
        var Messages = saverConfig.messages || {};

        var $configField = $('#realtime-frontend-getconfig');
        var pasedConfig;
        if ($configField.length) {
            try {
                parsedConfig = JSON.parse($configField.html());
            } catch (e) {
                console.error(e);
            }
        }
        var displayAvatarInMargin = typeof parsedConfig !== "undefined" ? parseInt(parsedConfig.marginAvatar) : 0;

        /** Key in the localStore which indicates realtime activity should be disallowed. */
        var LOCALSTORAGE_DISALLOW = editorConfig.LOCALSTORAGE_DISALLOW;

        var channel = docKeys.rtwysiwyg;
        var eventsChannel = docKeys.events;
        var userdataChannel = docKeys.userdata;

        // TOOLBAR style
        var TOOLBAR_CLS = Toolbar.TOOLBAR_CLS;
        var DEBUG_LINK_CLS = Toolbar.DEBUG_LINK_CLS;
        var toolbar_style = [
            '<style>',
            '.' + TOOLBAR_CLS + ' {',
            '    color: #666;',
            '    font-weight: bold;',
            '    height: 30px;',
            '    margin-bottom: -3px;',
            '    display: inline-block;',
            '    width: 100%;',
            '}',
            '.' + TOOLBAR_CLS + ' div {',
            '    padding: 0 10px;',
            '    height: 1.5em;',
            '    line-height: 25px;',
            '    height: 22px;',
            '}',
            '.' + TOOLBAR_CLS + ' div.rt-back {',
            '    padding: 0;',
            '    font-weight: bold;',
            '    cursor: pointer;',
            '    color: #000;',
            '}',
            '.gwt-TabBar {',
            '    display:none;',
            '}',
            '.' + DEBUG_LINK_CLS + ':link { color:transparent; }',
            '.' + DEBUG_LINK_CLS + ':link:hover { color:blue; }',
            '.gwt-TabPanelBottom { border-top: 0 none; }',
            '</style>'
        ];
        // END TOOLBAR style

        // DISALLOW REALTIME
        var uid = Interface.uid;
        var allowRealtimeCbId = uid();
        Interface.setLocalStorageDisallow(LOCALSTORAGE_DISALLOW);
        var checked = (Interface.realtimeAllowed()? 'checked="checked"' : '');

        Interface.createAllowRealtimeCheckbox(allowRealtimeCbId, checked, Messages.allowRealtime);
        // hide the toggle for autosaving while in realtime because it
        // conflicts with our own autosaving system
        Interface.setAutosaveHiddenState(true);

        var $disallowButton = $('#' + allowRealtimeCbId);
        var disallowClick = function () {
            var checked = $disallowButton[0].checked;
            //console.log("Value of 'allow realtime collaboration' is %s", checked);
            if (checked || DEMO_MODE) {
                Interface.realtimeAllowed(true);
                // TODO : join the RT session without reloading the page?
                window.location.reload();
            } else {
                Interface.realtimeAllowed(false);
                module.abortRealtime();
            }
        };
        $disallowButton.on('change', disallowClick);

        if (!Interface.realtimeAllowed()) {
            console.log("Realtime is disallowed. Quitting");
            return;
        }
        // END DISALLOW REALTIME

        // configure Saver with the merge URL and language settings
        Saver.configure(saverConfig);

        var whenReady = function (editor, iframe) {

            var inner = window.inner = iframe.contentWindow.body;
            var innerDoc = window.innerDoc = iframe.contentWindow.document;
            var cursor = window.cursor = Cursor(inner);

            // Fix the magic line issue
            var fixMagicLine = function () {
                if(editor.plugins.magicline.backdoor) {
                    editor.plugins.magicline.backdoor.that.line.$.setAttribute('class', 'rt-non-realtime');
                    console.log(editor.plugins.magicline.backdoor.that.line.$);
                    return;
                }
                setTimeout(fixMagicLine, 100);
            }
            // User position indicator style
            var userIconStyle = [
                '<style>',
                '.rt-user-position {',
                    'position : absolute;',
                    'width : 15px;',
                    'height: 15px;',
                    'display: inline-block;',
                    'background : #CCCCFF;',
                    'border : 1px solid #AAAAAA;',
                    'text-align : center;',
                    'line-height: 15px;',
                    'font-size: 11px;',
                    'font-weight: bold;',
                    'color: #3333FF;',
                    'user-select: none;',
                '}',
                '</style>'].join('\n');
            var addStyle = function() {
                inner = iframe.contentWindow.body;
                innerDoc = iframe.contentWindow.document;
                $('head', innerDoc).append(userIconStyle);
                fixMagicLine();
            };
            addStyle();
            // Add the style again when modifying a macro (which reloads the iframe)
            iframe.onload = addStyle;

            var setEditable = module.setEditable = function (bool) {
                inner.setAttribute('contenteditable', bool);
            };

            // don't let the user edit until the pad is ready
            setEditable(false);

            var diffOptions = {
                preDiffApply: function (info) {
                    if (info.node && isNonRealtime(info.node)) {
                        if (info.diff.action === "removeElement") {
                            return true;
                        }
                    }

                    /*
                     * Prevent diffdom from removing or modifying important macro elements
                     */
                    var isMacro = false;
                    // Macro container : should not be modified at all, unless it is removed completely
                    if (info.node && (info.node.tagName === 'DIV' || info.node.tagName === 'SPAN') &&
                            info.node.getAttribute('contenteditable') === 'false' &&
                            /macro/.test(info.node.getAttribute('data-cke-display-name')) ) {
                        isMacro = true;
                        if (info.diff.action === "removeElement" && info.diff.element.attributes &&
                                (info.diff.element.attributes.class === "cke_widget_wrapper cke_widget_block" ||
                                 info.diff.element.attributes.class === "cke_widget_wrapper cke_widget_inline") ) {
                            //console.log('Removing a macro');
                        } else {
                            //console.log('Preventing modification of a macro container', info.node);
                            //return true;
                        }
                    }
                    // CkEditor drag&drop for widgets
                    if (info.node && info.node.tagName === 'SPAN' &&
                            info.node.getAttribute('class') &&
                            info.node.getAttribute('class').split(' ').indexOf('cke_widget_drag_handler_container') !== -1) {
                        //console.log('Preventing removal of the drag&drop icon container of a macro', info.node);
                        return true;
                    }/*
                    if (info.node && info.node.tagName === 'IMG' &&
                            info.node.getAttribute('class') &&
                            info.node.getAttribute('class').split(' ').indexOf('cke_widget_drag_handler') !== -1) {
                        //console.log('Preventing removal of the drag&drop icon of a macro', info.node);
                        return true;
                    }*/
                    // Macro content : only the data elements should be modified.
                    if (info.node && (info.node.tagName === 'SPAN' || info.node.tagName === 'DIV') &&
                            info.node.getAttribute('data-widget') === "xwiki-macro") {
                        isMacro = true;
                        /*if (info.diff.action !== "modifyAttribute" || !info.diff.name ||
                                    (info.diff.name !== "data-cke-widget-data" && info.diff.name !== "data-macro")) {
                            //console.log('Preventing modification of a macro attributes');
                            return true;
                        }/* else if (info.diff.name === 'data-cke-widget-data') {
                            // Get the new data and put it in the JS object
                            try {
                                var widgetId = parseInt(info.node.parentNode.getAttribute('data-cke-widget-id'));
                                var widget = editor.widgets.instances[widgetId];
                                var data = JSON.parse(decodeURIComponent(info.diff.newValue));
                                widget.setData(data);
                            } catch (e) {
                                console.error(e);
                            }
                        }*/
                    }

                    if (info.node && info.node.tagName === "BODY") {
                        if (info.diff.action === "modifyAttribute" || (info.diff.action === "removeAttribute" && info.diff.name === "style")) {
                            return true;
                        }
                    }

                    // no use trying to recover the cursor if it doesn't exist
                    if (!cursor.exists()) { return; }

                    /*  frame is either 0, 1, 2, or 3, depending on which
                        cursor frames were affected: none, first, last, or both
                    */
                    var frame = info.frame = cursor.inNode(info.node);

                    if (!frame) { return; }

                    if (typeof info.diff.oldValue === 'string' && typeof info.diff.newValue === 'string') {
                        var pushes = cursor.pushDelta(info.diff.oldValue, info.diff.newValue);

                        if (frame & 1) {
                            // push cursor start if necessary
                            if (pushes.commonStart < cursor.Range.start.offset) {
                                cursor.Range.start.offset += pushes.delta;
                            }
                        }
                        if (frame & 2) {
                            // push cursor end if necessary
                            if (pushes.commonStart < cursor.Range.end.offset) {
                                cursor.Range.end.offset += pushes.delta;
                            }
                        }
                    }
                },
                postDiffApply: function (info) {
                    if (info.frame) {
                        if (info.node) {
                            if (info.frame & 1) { cursor.fixStart(info.node); }
                            if (info.frame & 2) { cursor.fixEnd(info.node); }
                        } else { console.error("info.node did not exist"); }

                        var sel = cursor.makeSelection();
                        var range = cursor.makeRange();

                        cursor.fixSelection(sel, range);
                    }
                }
            };


            var initializing = true;
            var userData = {}; // List of pretty name of all users (mapped with their server ID)
            var userList; // List of users still connected to the channel (server IDs)
            var myId;

            var DD = new DiffDom(diffOptions);

            var fixMacros = function () {
                var dataValues = {};
                var $elements = $(innerDoc).find('[data-cke-widget-data]');
                $elements.each(function (idx, el) {
                    dataValues[idx] = $(el).attr('data-cke-widget-data');
                });
                editor.widgets.instances = {};
                editor.widgets.checkWidgets();
                $elements.each(function (idx, el) {
                    $(el).attr('data-cke-widget-data', dataValues[idx]);
                });
            }

            // apply patches, and try not to lose the cursor in the process!
            var applyHjson = function (shjson) {
                var userDocStateDom = hjsonToDom(JSON.parse(shjson));
                userDocStateDom.setAttribute("contenteditable", "true"); // lol wtf
                var patch = (DD).diff(inner, userDocStateDom);
                (DD).apply(inner, patch);
                try { fixMacros(); } catch (e) { console.log("Unable to fix the macros", e); }
            };

            var realtimeOptions = {
                // provide initialstate...
                initialState: stringifyDOM(inner) || '{}',

                // the websocket URL
                websocketURL: WebsocketURL,

                // our username
                userName: userName,

                // the channel we will communicate over
                channel: channel,

                // Crypto object to avoid loading it twice in Cryptpad
                crypto: Crypto,

                // really basic operational transform
                transformFunction : JsonOT.validate
            };

            var createSaver = function (info) {
                if(!DEMO_MODE) {
                    Saver.lastSaved.mergeMessage = Interface.createMergeMessageElement(toolbar.toolbar
                        .find('.rt-toolbar-rightside'),
                        saverConfig.messages);
                    Saver.setLastSavedContent(editor._.previousModeData);
                    var saverCreateConfig = {
                        formId: "inline", // Id of the wiki page form
                        setTextValue: function(newText, toConvert, callback) {
                            if (toConvert) {
                                $.post(htmlConverterUrl+'?xpage=plain&outputSyntax=plain', {
                                    wiki: wiki,
                                    space: space,
                                    page: page,
                                    convert: true,
                                    text: newText
                                }).done(function(data) {
                                    var mydata = window.newDataCk = data
                                    var doc = window.DOMDoc = (new DOMParser()).parseFromString(mydata,"text/html");

                                    cursor.update();
                                    doc.body.setAttribute("contenteditable", "true");
                                    var patch = (DD).diff(inner, doc.body);
                                    (DD).apply(inner, patch);

                                    callback();
                                    onLocal();
                                });
                            } else {
                                var doc = window.DOMDoc = (new DOMParser()).parseFromString(newText,"text/html");

                                cursor.update();
                                doc.body.setAttribute("contenteditable", "true");
                                var patch = (DD).diff(inner, doc.body);
                                (DD).apply(inner, patch);

                                callback();
                                onLocal();
                            }
                        },
                        getSaveValue: function() {
                            return Object.toQueryString({
                              content: editor.getData(),
                              RequiresHTMLConversion: "content",
                              content_syntax: "xwiki/2.1"
                            });
                        },
                        getTextValue: function() {
                            return editor.getData();
                        },
                        realtime: info.realtime,
                        userList: info.userList,
                        userName: userName,
                        network: info.network,
                        channel: eventsChannel,
                        demoMode: DEMO_MODE
                    };
                    Saver.create(saverCreateConfig);
                }
            };

            var onRemote = realtimeOptions.onRemote = function (info) {
                if (initializing) { return; }

                var shjson = info.realtime.getUserDoc();
                //console.log(shjson); TODO
                //console.log(stringifyDOM(inner));

                // remember where the cursor is
                cursor.update();

                // build a dom from HJSON, diff, and patch the editor
                applyHjson(shjson);

                var shjson2 = stringifyDOM(inner);
                if (shjson2 !== shjson) {
                    console.error("shjson2 !== shjson");
                    console.log(shjson2);
                    console.log(shjson);
                    module.patchText(shjson2);
                }
            };

            var onInit = realtimeOptions.onInit = function (info) {
                var $bar = $('#cke_1_toolbox');
                userList = info.userList;
                var config = {
                    userData: userData
                };
                toolbar = Toolbar.create($bar, info.myID, info.realtime, info.getLag, info.userList, config, toolbar_style);
            };

            var getXPath = function (element) {
                var xpath = '';
                for ( ; element && element.nodeType == 1; element = element.parentNode ) {
                    var id = $(element.parentNode).children(element.tagName).index(element) + 1;
                    id > 1 ? (id = '[' + id + ']') : (id = '');
                    xpath = '/' + element.tagName.toLowerCase() + id + xpath;
                }
                return xpath;
            };

            var getPrettyName = function (userName) {
                return (userName) ? userName.replace(/^.*-([^-]*)%2d[0-9]*$/, function(all, one) { 
                    return decodeURIComponent(one);
                }) : userName;
            }

            editor.on( 'toDataFormat', function( evt) {
                var root = evt.data.dataValue;
                var toRemove = [];
                var toReplaceMacro = [];
                root.forEach( function( node ) {
                    if (node.name === "style") {
                        window.myNode = node;
                        toRemove.push(node);
                    }
                    if (typeof node.hasClass === "function") {
                        if (node.hasClass("rt-non-realtime")) {
                            toRemove.push(node);
                        } else if (node.hasClass("macro") &&
                                node.attributes &&
                                node.attributes['data-macro'] &&
                                node.parent &&
                                node.parent.attributes &&
                                node.parent.attributes.contenteditable === "false") {
                            toReplaceMacro.push(node);
                        }
                    }
                }, null, true );
                toRemove.forEach(function (el) {
                if (!el) { return; }
                    el.forEach(function (node) {
                        node.remove();
                    });
                });
                var macroWidget;
                for (var widget in editor.widgets.instances) {
                    if (widget.name && widget.name === 'xwiki-macro') {
                        macroWidget = widget;
                        break;
                    }
                }
                if (macroWidget) {
                    toReplaceMacro.forEach(function (el) {
                        var container = el.parent;
                        var newNode = macroWidget.downcast(el);
                        var index = container.parent.children.indexOf(container);
                        container.parent.children[index] = newNode;
                    });
                }
            }, null, null, 12 );

            var changeUserIcons = function (newdata) {
                if (!displayAvatarInMargin || displayAvatarInMargin == 0) { return; }

                // If no new data (someone has just joined or left the channel), get the latest known values
                var updatedData = newdata || userData;

                var activeUsers = userList.users.slice(0);

                $(innerDoc).find('.rt-user-position').remove();
                var positions = REALTIME_DEBUG.positions = {};
                var requiredPadding = 0;
                for (var i=0; i<activeUsers.length; i++) {
                    var id = activeUsers[i];
                    var data = updatedData[id];
                    if (!data) { return; }
                    var name = getPrettyName (data.name);

                    // Set the user position
                    var element = undefined; // If not declared as undefined, it keeps the previous value from the loop
                    if (data.cursor_rtwysiwyg) {
                        element = innerDoc.evaluate(data.cursor_rtwysiwyg, innerDoc, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null ).singleNodeValue;
                    }
                    if (element) {
                        var pos = $(element).offset();
                        if (!positions[pos.top]) {
                            positions[pos.top] = [id];
                        } else {
                            positions[pos.top].push(id);
                        }
                        var index = positions[pos.top].length - 1;
                        var posTop = pos.top + 3;
                        var posLeft = index * 16;
                        requiredPadding = Math.max(requiredPadding, (posLeft+10));
                        var $indicator;
                        if (data.avatar) {
                            $indicator = $('<img src="' + data.avatar + '?width=15" alt="" />');
                        } else {
                            $indicator = $('<div>' + name.substr(0,1) + '</div>');
                        }
                        $indicator.addClass("rt-non-realtime rt-user-position");
                        $indicator.attr("contenteditable", "false");
                        $indicator.attr("id", "rt-user-" + id);
                        $indicator.attr("title", name);
                        $indicator.css({
                            "left" : posLeft + "px",
                            "top" : posTop + "px"
                        });
                        $('html', innerDoc).append($indicator);
                    }
                }
                requiredPadding += 15;
                $(inner).css("padding-left", requiredPadding+'px');
            }

            var onReady = realtimeOptions.onReady = function (info) {
                if (!initializing) { return; }

                var realtime = window.realtime = module.realtime = info.realtime;
                module.leaveChannel = info.leave;
                module.patchText = TextPatcher.create({
                    realtime: realtime,
                    logging: false,
                });
                var shjson = realtime.getUserDoc();

                myId = info.myId;

                // Update the user list to link the wiki name to the user id
                var userdataConfig = {
                    myId : info.myId,
                    userName : userName,
                    userAvatar : userAvatar,
                    onChange : userList.onChange,
                    crypto : Crypto,
                    transformFunction : JsonOT.validate,
                    editor : 'rtwysiwyg',
                    getCursor : function() {
                        var selection = editor.getSelection().getRanges();
                        if (!selection || !selection[0]) { return ""; }
                        var node = selection[0].startContainer.$;
                        node = (node.nodeName === "#text") ? node.parentNode : node;
                        var xpath = getXPath(node);
                        return xpath;
                    }
                };
                userData = UserData.start(info.network, userdataChannel, userdataConfig);
                userList.change.push(changeUserIcons);

                applyHjson(shjson);

                console.log("Unlocking editor");
                initializing = false;
                setEditable(true);

                onLocal();
                createSaver(info);
            };

            var onAbort = realtimeOptions.onAbort = function (info) {
                console.log("Aborting the session!");
                // TODO inform them that the session was torn down
                toolbar.failed();
                toolbar.toolbar.remove();
                if($disallowButton[0].checked && !module.aborted) {
                    ErrorBox.show('disconnected');
                }
            };

            var onLocal = realtimeOptions.onLocal = function () {
                if (initializing) { return; }

                // stringify the json and send it into chainpad
                var shjson = stringifyDOM(inner);
                module.patchText(shjson);

                if (module.realtime.getUserDoc() !== shjson) {
                    console.error("realtime.getUserDoc() !== shjson");
                }
            };

            var rti = module.realtimeInput = realtimeInput.start(realtimeOptions);
            module.abortRealtime = function () {
                module.realtime.abort();
                module.leaveChannel();
                module.aborted = true;
                Saver.stop();
                onAbort();
            };

            /* hitting enter makes a new line, but places the cursor inside
                of the <br> instead of the <p>. This makes it such that you
                cannot type until you click, which is rather unnacceptable.
                If the cursor is ever inside such a <br>, you probably want
                to push it out to the parent element, which ought to be a
                paragraph tag. This needs to be done on keydown, otherwise
                the first such keypress will not be inserted into the P. */
            inner.addEventListener('keydown', cursor.brFix);

            editor.on('change', function() {
                Saver.destroyDialog();
                Saver.setLocalEditFlag(true);
                onLocal();
                if (inner !== iframe.contentWindow.body) {
                    console.log('New inner body');
                    //inner = iframe.contentWindow.body;
                }
            });

            // export the typing tests to the window.
            // call like `test = easyTest()`
            // terminate the test like `test.cancel()`
            var easyTest = window.easyTest = function () {
                cursor.update();
                var start = cursor.Range.start;
                var test = TypingTest.testInput(inner, start.el, start.offset, onLocal);
                onLocal();
                return test;
            };
        };

        var untilThen = function () {
            var $iframe = $('iframe');
            if (window.CKEDITOR &&
                window.CKEDITOR.instances &&
                window.CKEDITOR.instances.content &&
                $iframe.length &&
                $iframe[0].contentWindow &&
                $iframe[0].contentWindow.body) {
                return whenReady(window.CKEDITOR.instances.content, $iframe[0]);
            }
            setTimeout(untilThen, 100);
        };
        /* wait for the existence of CKEDITOR before doing things...  */
        untilThen();
    };

    return module;
});
