define([
    'RTWysiwyg_WebHome_messages'
], function (Messages) {

    /** Id of the element for getting debug info. */
    var DEBUG_LINK_CLS = 'rtwysiwyg-debug-link';

    /** Id of the div containing the user list. */
    var USER_LIST_CLS = 'rtwysiwyg-user-list';

    /** Id of the div containing the lag info. */
    var LAG_ELEM_CLS = 'rtwysiwyg-lag';

    /** The toolbar class which contains the user list, debug link and lag. */
    var TOOLBAR_CLS = 'rtwysiwyg-toolbar';

    /** Key in the localStore which indicates realtime activity should be disallowed. */
    var LOCALSTORAGE_DISALLOW = 'rtwysiwyg-disallow';

    var SPINNER_DISAPPEAR_TIME = 3000;
    var SPINNER = [ '-', '\\', '|', '/' ];

    var uid = function () {
        return 'rtwysiwyg-uid-' + String(Math.random()).substring(2);
    };

    var destroy = function ($container) {

    };

    var createRealtimeToolbar = function ($container) {
        var id = uid();
        $container.prepend(
            '<div class="' + TOOLBAR_CLS + '" id="' + id + '">' +
                '<div class="rtwysiwyg-toolbar-leftside"></div>' +
                '<div class="rtwysiwyg-toolbar-rightside"></div>' +
            '</div>'
        );
        var toolbar = $container.find('#'+id);
        toolbar.append([
            '<style>',
            '.' + TOOLBAR_CLS + ' {',
            '    color: #666;',
            '    font-weight: bold;',
//            '    background-color: #f0f0ee;',
//            '    border-bottom: 1px solid #DDD;',
//            '    border-top: 3px solid #CCC;',
//            '    border-right: 2px solid #CCC;',
//            '    border-left: 2px solid #CCC;',
            '    height: 26px;',
            '    margin-bottom: -3px;',
            '    display: inline-block;',
            '    width: 100%;',
            '}',
            '.' + TOOLBAR_CLS + ' a {',
            '    float: right;',
            '}',
            '.' + TOOLBAR_CLS + ' div {',
            '    padding: 0 10px;',
            '    height: 1.5em;',
//            '    background: #f0f0ee;',
            '    line-height: 25px;',
            '    height: 22px;',
            '}',
            '.rtwysiwyg-toolbar-leftside div {',
            '    float: left;',
            '}',
            '.rtwysiwyg-toolbar-leftside {',
            '    float: left;',
            '}',
            '.rtwysiwyg-toolbar-rightside {',
            '    float: right;',
            '}',
            '.rtwysiwyg-lag {',
            '    float: right;',
            '}',
            '.rtwysiwyg-spinner {',
            '    float: left;',
            '}',
            '.gwt-TabBar {',
            '    display:none;',
            '}',
            '.' + DEBUG_LINK_CLS + ':link { color:transparent; }',
            '.' + DEBUG_LINK_CLS + ':link:hover { color:blue; }',
            '.gwt-TabPanelBottom { border-top: 0 none; }',

            '</style>'
         ].join('\n'));
        return toolbar;
    };

    var createSpinner = function ($container) {
        var id = uid();
        $container.append('<div class="rtwysiwyg-spinner" id="'+id+'"></div>');
        return $container.find('#'+id)[0];
    };

    var kickSpinner = function (spinnerElement, reversed) {
        var txt = spinnerElement.textContent || '-';
        var inc = (reversed) ? -1 : 1;
        spinnerElement.textContent = SPINNER[(SPINNER.indexOf(txt) + inc) % SPINNER.length];
        if (spinnerElement.timeout) { clearTimeout(spinnerElement.timeout); }
        spinnerElement.timeout = setTimeout(function () {
            spinnerElement.textContent = '';
        }, SPINNER_DISAPPEAR_TIME);
    };

    var createUserList = function ($container) {
        var id = uid();
        $container.append('<div class="' + USER_LIST_CLS + '" id="'+id+'"></div>');
        return $container.find('#'+id)[0];
    };

    var getOtherUsers = function(myUserName, userList) {
      var i = 0;
      var list = '';
      userList.forEach(function(user) {
        if(user !== myUserName) {
          var userName = user.replace(/^.*-([^-]*)%2d[0-9]*$/, function(all, one) {
            return decodeURIComponent(one);
          });
          if(userName) {
            if(i === 0) list = ' : ';
            list += userName + ', ';
            i++;
          }
        }
      });
      return (i > 0) ? list.slice(0, -2) : list;
    };

    var updateUserList = function (myUserName, listElement, userList) {
        var meIdx = userList.indexOf(myUserName);
        if (meIdx === -1) {
            listElement.textContent = Messages.synchronizing;
            return;
        }
        var userNamesList = getOtherUsers(myUserName, userList);
        if (userList.length === 1) {
            listElement.textContent = Messages.editingAlone;
        } else if (userList.length === 2) {
            listElement.textContent = Messages.editingWithOneOtherPerson + userNamesList;
        } else {
            listElement.textContent = Messages.editingWith + ' ' + (userList.length - 1) + ' ' + Messages.otherPeople + userNamesList;
        }
    };

    var createLagElement = function ($container) {
        var id = uid();
        $container.append('<div class="' + LAG_ELEM_CLS + '" id="'+id+'"></div>');
        return $container.find('#'+id)[0];
    };

    var checkLag = function (realtime, lagElement) {
        var lag = realtime.getLag();
        var lagSec = lag.lag/1000;
        var lagMsg = Messages.lag + ' ';
        if (lag.waiting && lagSec > 1) {
            lagMsg += "?? " + Math.floor(lagSec);
        } else {
            lagMsg += lagSec;
        }
        lagElement.textContent = lagMsg;
    };

    // this is a little hack, it should go in it's own file.
    // FIXME ok, so let's put it in its own file then
    // TODO there should also be a 'clear recent pads' button
    var rememberPad = function () {
        // FIXME, this is overly complicated, use array methods
        var recentPadsStr = localStorage['CryptPad_RECENTPADS'];
        var recentPads = [];
        if (recentPadsStr) { recentPads = JSON.parse(recentPadsStr); }
        // TODO use window.location.hash or something like that
        if (window.location.href.indexOf('#') === -1) { return; }
        var now = new Date();
        var out = [];
        for (var i = recentPads.length; i >= 0; i--) {
            if (recentPads[i] &&
                // TODO precompute this time value, maybe make it configurable?
                // FIXME precompute the date too, why getTime every time?
                now.getTime() - recentPads[i][1] < (1000*60*60*24*30) &&
                recentPads[i][0] !== window.location.href)
            {
                out.push(recentPads[i]);
            }
        }
        out.push([window.location.href, now.getTime()]);
        localStorage['CryptPad_RECENTPADS'] = JSON.stringify(out);
    };

    var create = function ($container, myUserName, realtime) {
        var toolbar = createRealtimeToolbar($container);
        var userListElement = createUserList(toolbar.find('.rtwysiwyg-toolbar-leftside'));
        var spinner = createSpinner(toolbar.find('.rtwysiwyg-toolbar-rightside'));
        var lagElement = createLagElement(toolbar.find('.rtwysiwyg-toolbar-rightside'));

        rememberPad();

        var connected = false;

        realtime.onUserListChange(function (userList) {
            if (userList.indexOf(myUserName) !== -1) { connected = true; }
            if (!connected) { return; }
            updateUserList(myUserName, userListElement, userList);
        });

        var ks = function () {
            if (connected) { kickSpinner(spinner, false); }
        };

        realtime.onPatch(ks);
        // Try to filter out non-patch messages, doesn't have to be perfect this is just the spinner
        realtime.onMessage(function (msg) { if (msg.indexOf(':[2,') > -1) { ks(); } });

        setInterval(function () {
            if (!connected) { return; }
            checkLag(realtime, lagElement);
        }, 3000);

        return {
            failed: function () {
                connected = false;
                userListElement.textContent = '';
                lagElement.textContent = '';
            },
            reconnecting: function () {
                connected = false;
                userListElement.textContent = Messages.reconnecting;
                lagElement.textContent = '';
            },
            connected: function () {
                connected = true;
            },
            destroy: function () {
                toolbar.remove();
            }
        };
    };

    return { create: create };
});
