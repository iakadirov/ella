// Debugging tools
;;; function alert_dump(obj, name) {
;;;     var s = name ? name + ":\n" : '';
;;;     for (var i in obj) s += i + ': ' + obj[i] + "\n";
;;;     alert(s);
;;; }
function carp() {
    try {
        $('#debug').append($('<p>').text($.makeArray(arguments).join(' ')));
    } catch(e) { }
    try {
        console.log.apply(this, arguments);
    } catch(e) {
        try {
            console.log(arguments);
        } catch(e) { }
    }
}

var BASE_PATH = window.BASE_URL ? BASE_URL.substr(0, BASE_URL.length-1) : '';

var LF = 10, CR = 13;

// localization
var _;
if (window.gettext) _ = gettext;
else {
    carp('i18n broken -- gettext is not defined');
    _ = function(s) { return s; };
}

( function($) { $(document).ready( function() {
    
    // We need to remember what URL is loaded in which element,
    // so we can load or not load content appropriately on hash change.
    var LOADED_URLS = {};
    
    var ORIGINAL_TITLE = document.title;
    
    // If the hash changes before all ajax requests complete,
    // we want to cancel the pending requests. MAX_REQUEST is actually the number
    // of the last hashchange event. Each ajax request then remembers the state
    // of this variable when it was issued and if it's obsolete by the time it's
    // finished, the results are discarded. It's OK to discard it because it
    // never gets into LOADED_URLS.
    var MAX_REQUEST = 0;
    
    // When a sequence of URLs to load into various elements is given,
    // the requests are stored in this fifo and their results are
    // rendered into the document as they become ready, but always in order.
    var LOAD_BUF = [];
    // These are the indices into the LOAD_BUF array -- MIN_LOAD is the index
    // of the request to be processed next (there should never be any defined
    // fields in LOAD_BUF at position less than MIN_LOAD).
    // MAX_LOAD should pretty much always be LOAD_BUF.length - 1.
    var MIN_LOAD, MAX_LOAD = -1;
    
    // When something is loaded into an element that has no base view (in urls.js),
    // and the user hits back, we need to reload. But then we don't want to reload again,
    // so keep information about whether we manipulated the content, so we can
    // abstain from reloading if we have not.
    var PAGE_CHANGED = 0;
    
    function object_empty(o) {
        for (var k in o) return false;
        return true;
    }
    function keys(o) {
        var rv = [];
        for (var k in o) rv.push(k);
        return rv;
    }
    
    function inject_content($target, data, address) {
        // whatever was loaded inside, remove it from LOADED_URLS
        if (!object_empty(LOADED_URLS)) {
            var sel = '#'+keys(LOADED_URLS).join(',#');
            $target.find(sel).each(function() {
                delete LOADED_URLS[ this.id ];
            });
        }
        
        $target.removeClass('loading').html(data);
        var newtitle = $('#doc-title').text();
        document.title = (newtitle ? newtitle+' | ' : '') + ORIGINAL_TITLE;
        dec_loading();
        if (address != undefined) {
            LOADED_URLS[ $target.attr('id') ] = address;
        }
        PAGE_CHANGED++;
    }
    
    // Check if the least present request has finished and if so, shift it
    // from the queue and render the results, and then call itself recursively.
    // This effectively renders all finished requests from the first up to the
    // first pending one, where it stops. If all requests are finished,
    // the queue gets cleaned and the indices reset.
    function draw_ready() {
        
        // Slide up to the first defined request or to the end of the queue
        while (!LOAD_BUF[ MIN_LOAD ] && LOAD_BUF.length > MIN_LOAD+1) MIN_LOAD++;
        
        // If the queue is empty, clean it
        if (!LOAD_BUF[ MIN_LOAD ]) {
//            ;;; carp("Emptying buffer");
            LOAD_BUF = [];
            MIN_LOAD = undefined;
            MAX_LOAD = -1;
            $(document).trigger('content_added').removeData('injection_storage');
            return;
        }
        var info = LOAD_BUF[ MIN_LOAD ];
        
        if (!info.data) return; // Not yet ready
        
        delete LOAD_BUF[ MIN_LOAD ];
        while (LOAD_BUF.length > MIN_LOAD+1 && !LOAD_BUF[ ++MIN_LOAD ]) {}
        var $target = $('#'+info.target_id);
        if ($target && $target.jquery && $target.length) {} else {
            carp('Could not find target element: #'+info.target_id);
            dec_loading();
            draw_ready();
            return;
        }
        
        inject_content($target, info.data, info.address);
        
        // Track what elements were loaded
        function record_injection(target_id) {
            var injection_storage = $(document).data('injection_storage');
            if (injection_storage && injection_storage.push)
                injection_storage.push(target_id);
            else
                $(document).data('injection_storage', [target_id]);
        }
        record_injection(info.target_id);
        
        // Check next request
        draw_ready();
    }
    
    // This removes a request from the queue
    function cancel_request( load_id ) {
        var info = LOAD_BUF[ load_id ];
        delete LOAD_BUF[ load_id ];
        $('#'+info.target_id).removeClass('loading');
        dec_loading();
        
        // Restore the hash so it doesn't look like the request succeeded.
        url_target_id = ((info.target_id == 'content') ? '' : info.target_id+'::');
        adr(url_target_id + (LOADED_URLS[info.target_id] ? LOADED_URLS[info.target_id] : ''));
        
        carp('Failed to load '+info.address+' into '+info.target_id);
    }
    
    // Take a container and a URL. Give the container the "loading" class,
    // fetch the URL, push the request into the queue, and when it finishes,
    // check for requests ready to be loaded into the document.
    function load_content(arg) {
        var target_id = arg.target_id;
        var address = arg.address;
        ;;; carp('loading '+address+' into '+target_id);
            
        // An empty address means we should revert to the base state.
        // If one is not set up for the given container, reload the whole page.
        if (address.length == 0) {
            if (BASES[ target_id ]) {
                address = BASES[ target_id ];
            } else {
                if (PAGE_CHANGED) location.reload();
                return;
            }
        }
        
        $('#'+target_id).addClass('loading');
        show_loading();
        
        var url = $('<a>').attr('href', address).get(0).href;
        var load_id = ++MAX_LOAD;
        if (MIN_LOAD == undefined || load_id < MIN_LOAD) MIN_LOAD = load_id;
        LOAD_BUF[ load_id ] = {
            target_id: target_id,
            address: address
        };
        $.ajax({
            url: url,
            type: 'GET',
            success: function(data) {
                if (this.request_no < MAX_REQUEST) {
                    cancel_request( this.load_id );
                }
                else {
                    LOAD_BUF[ this.load_id ].data = data;
                }
                draw_ready();
            },
            error: function() {
                cancel_request( this.load_id );
                draw_ready();
            },
            load_id: load_id,
            request_no: MAX_REQUEST
        });
    }
    
    // We want location.hash to exactly describe what's on the page.
    // #url means that the result of $.get(url) be loaded into the #content div.
    // #id::url means that the result of $.get(url) be loaded into the #id element.
    // Any number of such specifiers can be concatenated, e.g. #/some/page/#header::/my/header/
    // If URLS[ foo ] is set (in urls.js), and #foo is present,
    // then the function is called given the $target as argument
    // and nothing else is done for this specifier.
    function load_by_hash() {
        var hash = location.hash.substr(1);
//        ;;; carp('load #'+MAX_REQUEST+'; hash: '+hash)
        
        // Figure out what should be reloaded and what not by comparing the requested things with the loaded ones.
        var requested = {};
        var specifiers = hash.split('#');
        var ids_map = {};
        var ids_arr = [];
        for (var i = 0; i < specifiers.length; i++) {
            var spec = specifiers[ i ];
            var address = spec;
            var target_id = 'content';
            if (spec.match(/^([-\w]+)::(.*)/)) {
                target_id  = RegExp.$1;
                address = RegExp.$2;
            }
            requested[ target_id ] = address;
            ids_map[ target_id ] = 1;
            ids_arr.push(target_id);
        }
        for (var k in LOADED_URLS)  if (!ids_map[ k ]) {
            ids_map[ k ] = 1;
            ids_arr.push(k);
        }
        var is_ancestor = {};
        for (var ai = 0; ai < ids_arr.length; ai++) {
            for (var di = 0; di < ids_arr.length; di++) {
                if (ai == di) continue;
                var aid = ids_arr[ai];
                var did = ids_arr[di];
                var $d = $('#'+did);
                if ($d && $d.length) {} else continue;
                var $anc = $d.parent().closest('#'+aid);
                if ($anc && $anc.length) {
                    is_ancestor[ aid+','+did ] = 1;
                }
            }
        }
        var processed = {};
        var reload_target = {};
        while (!object_empty(ids_map)) {
            
            // draw an element that's independent on any other in the list
            var ids = [];
            for (var id in ids_map) ids.push(id);
            var indep;
            for (var i = 0; i < ids.length; i++) {
                var top_el_id = ids[i];
                var is_independent = true;
                for (var j = 0; j < ids.length; j++) {
                    var low_el_id = ids[j];
                    if (low_el_id == top_el_id) continue;
                    if (is_ancestor[ low_el_id + ',' + top_el_id ]) {
                        is_independent = false;
                        break;
                    }
                }
                if (is_independent) {
                    indep = top_el_id;
                    delete ids_map[ top_el_id ];
                    break;
                }
            }
            if (!indep) {
                carp(ids_map);
                throw('Cyclic graph of elements???');
            }
            
            var result = {};
            for (var par in processed) {
                // if we went over an ancestor of this element
                if (is_ancestor[ par+','+indep ]) {
                    // and we marked it for reload
                    if (processed[ par ].to_reload) {
                        // and we're not just recovering
                        if (requested[ indep ]) {
                            // then reload no matter if url changed or not
                            result.to_reload = true;
                            break;
                        }
                        else {
                            // no need to recover when parent gets reloaded
                            result.to_reload = false;
                            break;
                        }
                    }
                }
            }
            
            // If parent didn't force reload or delete,
            if (result.to_reload == undefined) {
                // and the thing is no longer requested and we don't have the base loaded,
                if (!requested[ indep ] && LOADED_URLS[ indep ] != '') {
                    // then reload the base
                    result.to_reload = 1;
                }
            }
            
            if (result.to_reload == undefined) {
                // If the requested url changed,
                if (requested[ indep ] != LOADED_URLS[ indep ]) {
                    // mark for reload
                    result.to_reload = 1;
                }
            }
            
            // If we want to reload but no URL is set, default to the base
            if (result.to_reload && !requested[ indep ]) {
                requested[ indep ] = '';
            }
            
            processed[ indep ] = result;
        }
        // Now we figured out what to reload.
        
        for (var target_id in requested) {
            if (!processed[ target_id ].to_reload) {
                continue;
            }
            var address = requested[ target_id ];
            
            // A specially treated specifier. The callback should set up LOADED_URLS properly.
            // FIXME: Rewrite
            if (URLS[address]) {
                URLS[address](target_id);
                continue;
            }
            
            load_content({
                target_id: target_id,
                address: address
            });
        }
    }
    
    // Fire hashchange event fired when location.hash changes
    var CURRENT_HASH = '';
    $().bind('hashchange', function() {
//        carp('hash: ' + location.hash);
        MAX_REQUEST++;
        $('.loading').removeClass('loading');
        hide_loading();
        load_by_hash();
    });
    setTimeout( function() {
        var q;  // queue of user-defined callbacks
        try {
            if (location.hash != CURRENT_HASH) {
                CURRENT_HASH = location.hash;
                $().trigger('hashchange');
            }
        } catch(e) { carp(e); }
        setTimeout(arguments.callee, 50);
    }, 50);
    // End of hash-driven content management
    
    // Loads stuff from an URL to an element like load_by_hash but:
    // - Only one specifier (id-url pair) can be given.
    // - URL hash doesn't change.
    // - The specifier is interpreted by adr to get the URL from which to ajax.
    //   This results in support of relative addresses and the target_id::rel_base::address syntax.
    function simple_load(specifier) {
        var target_id, address;
        var colon_index = specifier.indexOf('::');
        if (colon_index < 0) {
            target_id = 'content';
            address = specifier;
        }
        else {
            target_id = specifier.substr(0, colon_index);
            address = specifier.substr(colon_index + '::'.length);
        }
        colon_index = address.indexOf('::');
        if (colon_index >= 0) {
            address = address.substr(colon_index + '::'.length);
        }
        
        if (LOADED_URLS[target_id] == address) return;
        
        var url = adr(specifier, {just_get:1});
        var url = $('<a>').attr('href', url).get(0).href;
        
        var $target = $('#'+target_id);
        if ($target && $target.length) {} else {
            throw("Target '#"+target_id+"' not found.");
            return;
        }
        $target.addClass('loading');
        show_loading();
        $.get(url, function(data) {
            inject_content($target, data, address);
            $(document)
                .data('injection_storage', [$target.attr('id')])
                .trigger('content_added')
                .removeData('injection_storage');
        });
    }
    
    // Set up event handlers
    $('.simpleload,.simpleload-container a').live('click', function(evt) {
        if (evt.which != 1) return true;
        simple_load($(this).attr('href'));
        return false;
    });
    $('.hashadr,.hashadr-container a').live('click', function(evt) {
        if (evt.which != 1) return true;
        adr($(this).attr('href'));
        return false;
    });
})})(jQuery);

// Manipulate the hash address.
// 
// We use http://admin/#/foo/ instead of http://admin/foo/.
// Therefore, <a href="bar/"> won't lead to http://admin/#/foo/bar/ as we need but to http://admin/bar/.
// To compensate for this, use <a href="javascript:adr('bar/')> instead.
// adr('id::bar/') can be used too.
// 
// adr('bar/#id::baz/') is the same as adr('bar/'); adr('id::baz/').
// Absolute paths and ?var=val strings work too.
// 
// Alternatively, you can use <a href="bar/" class="hashadr">.
// The hashadr class says clicks should be captured and delegated to function adr.
// A third way is to encapsulate a link (<a>) into a .hashadr-container element.
// 
// The target_id::rel_base::address syntax in a specifier means that address is taken as relative
// to the one loaded to rel_base and the result is loaded into target_id.
// For example, suppose that location.hash == '#id1::/foo/'. Then calling
// adr('id2::id1::bar/') would be like doing location.hash = '#id1::/foo/#id2::/foo/bar/'.
// 
// The second argument is an object where these fields are recognized:
// - hash: a custom hash string to be used instead of location.hash,
// - just_get: Instructs the function to merely return the modified address (without the target_id).
//   Using this option disables the support of multiple '#'-separated specifiers.
//   Other than the first one are ignored.
function adr(address, options) {
    if (address == undefined) {
        carp('No address given to adr()');
        return;
    }
    
    // '#' chars in the address separate invividual requests for hash modification.
    // First deal with the first one and then recurse on the subsequent ones.
    if (address.charAt(0) == '#') address = address.substr(1);
    var hashpos = (address+'#').indexOf('#');
    var tail = address.substr(hashpos+1);
    address = address.substr(0, hashpos);
    
    if (!options) options = {};
    var hash = (options.hash == undefined) ? location.hash : options.hash;
    
    // Figure out which specifier is concerned.
    var target_id = '';
    // But wait, if target_id::rel_base::address was specified,
    // then get the modifier address and insert it then as appropriate.
    var new_address;
    if (address.match(/([-\w]*)::([-\w]*)::(.*)/)) {
        var rel_base;
        target_id = RegExp.$1;
        rel_base  = RegExp.$2;
        address   = RegExp.$3;
        if (rel_base.length) rel_base  += '::';
        new_address = adr(rel_base+address, {hash:hash, just_get:1})
        if (options.just_get) return new_address;
    }
    // OK, go on figuring out which specifier is concerned.
    else if (address.match(/([-\w]*)::(.*)/)) {
        target_id = RegExp.$1;
        address   = RegExp.$2;
    }
    
    // If no hash is present, simply use the address.
    if (hash.length <= 1) {
        var newhash;
        if (target_id.length == 0) {
            newhash = address;
        }
        else {
            newhash = target_id + '::' + address
        }
        if (options.just_get) return newhash;
        else {
            location.hash = newhash;
            return;
        }
    }
    
    // Figure out the span in the current hash where the change applies.
    var start = 0;
    var end;
    var specifier_prefix = '';
    if (target_id.length == 0) {
        for (; start >= 0; start = hash.indexOf('#', start+1)) {
            end = (hash+'#').indexOf('#', start+1);
            if (hash.substring(start, end).indexOf('::') < 0) {
                start++;
                break;
            }
        }
        if (start < 0) {
            hash += '#';
            start = end = hash.length;
        }
    }
    else {
        var idpos = hash.indexOf(target_id+'::');
        if (idpos == -1) {
            hash += '#';
            start = end = hash.length;
            specifier_prefix = target_id + '::';
        }
        else {
            start = idpos + target_id.length + '::'.length;
            end = (hash+'#').indexOf('#', start);
        }
    }
    // Now, hash.substr(start,end) is the address we need to modify.
    
    // Figure out whether we replace the address, append to it, or what.
    // Move start appropriately to denote where the part to replace starts.
    
    var newhash;
    var addr_start = start;
    
    // We've not gotten the address from a previous recursive call, thus modify the address as needed.
    if (new_address == undefined) {
        new_address = address;
        
        // empty address -- remove the specifier
        if (address.length == 0) {
            start = hash.lastIndexOf('#',start);
            start = Math.max(start,0);
        }
        // absolute address -- replace what's in there.
        else if (address.charAt(0) == '/') {
            new_address = BASE_PATH + new_address;
        }
        // relative address -- append to the end, but no farther than to a '?'
        else {
            var left_anchor = hash.lastIndexOf('#', start)+1;
            start = (hash.substr(0, end)+'?').indexOf('?', start);
            
            // cut off the directories as appropriate when the address starts with ../
            while (new_address.substr(0,3) == '../' && hash.substring(left_anchor,start-1).indexOf('/') >= 0) {
                new_address = new_address.substr(3);
                start = hash.lastIndexOf('/', start-2)+1;
            }
        }
    }
    
    newhash = hash.substr(0, start) + specifier_prefix + new_address + hash.substr(end);
    
    if (options.just_get) {
        return hash.substring(addr_start, start) + new_address;
    }
    else if (tail) {
        adr(tail, {hash:newhash});
    }
    else {
        location.hash = newhash;
    }
}
function get_adr(address, options) {
    if (!options) options = {};
    options.just_get = 1;
    return adr(address, options);
}

// Get an URL to a CSS or JS file, attempt to load it into the document and call callback on success.
function load_media(url, succ_fn, err_fn) {
    ;;; carp('loading media '+url);
    
    url.match(/(?:.*\/\/[^\/]*)?([^?]+)(?:\?.*)?/);
    $(document).data('loaded_media')[ RegExp.$1 ] = url;
    
    if (url.match(/\.(\w+)(?:$|\?)/))
        var ext = RegExp.$1;
    else throw('Unexpected URL format: '+url);
    
    var abs_url = $('<a>').attr({href:url}).get(0).href;
    
    function stylesheet_present(url) {
        for (var i = 0; i < document.styleSheets.length; i++) {
            if (document.styleSheets[i].href == url) return document.styleSheets[i];
        }
        return false;
    }
    function get_css_rules(stylesheet) {
        try {
            if (stylesheet.cssRules) return stylesheet.cssRules;
            if (stylesheet.rules   ) return stylesheet.rules;
        } catch(e) { carp(e); }
        carp('Could not get rules from: ', stylesheet);
        return;
    }
    
    if (ext == 'css') {
        if (stylesheet_present(abs_url)) return true;
        var tries = 100;
        if ($.isFunction(succ_fn)) {
            setTimeout(function() {
                if (--tries < 0) {
                    carp('Timed out loading CSS: '+url);
                    if ($.isFunction(err_fn)) err_fn(url);
                    return;
                }
                var ss;
                if (ss = stylesheet_present(abs_url)) {
                    var rules = get_css_rules(ss);
                    if (rules && rules.length) succ_fn(url);
                    else {
                        if (rules) carp('CSS stylesheet empty.');
                        if ($.isFunction(err_fn)) err_fn(url);
                        return;
                    }
                }
                else setTimeout(arguments.callee, 100);
            }, 100);
        }
        return $('<link rel="stylesheet" type="text/css" href="'+url+'" />').appendTo($('head'));
    }
    else if (ext == 'js') {
        var $scripts = $('script');
        for (var i = 0; i < $scripts.length; i++) {
            if ($scripts.get(i).src == abs_url) return true;
        }
        return $.ajax({
            url:       url,
            type:     'GET',
            dataType: 'script',
            success:   succ_fn,
            error:     err_fn,
            cache:     true
        });
    }
    else throw('Unrecognized media type "'+ext+'" in URL: '+url);
}


var media_queue = [];
$(document).data('loaded_media', {});
function init_media() {
    $(document).trigger('media_loaded').data('loaded_media', {});
}
function draw_media() {
    if (media_queue.length == 0) {
        init_media();
        return true;
    }
    var url = media_queue.shift();
    load_media(url, draw_media, draw_media);
}

// Load a CSS / JavaScript file (given an URL) after previously requested ones have been loaded / failed loading.
function request_media(url) {
    var do_start = media_queue.length == 0;
    media_queue.push(url);
    if (do_start) {
        setTimeout(draw_media,20);
    }
}


/////// END OF THE CONTENT-BY-HASH LIBRARY

/////// CODE FOR CONTENT-SPECIFIC USE

//// Drafts and templates
(function() {
    var draft_id;
    function save_preset($form, options) {
        var form_data = JSON.stringify( $form.serializeArray() );
        var things_to_send = {data: form_data};
        if (!options) options = {};
        if (options.title) things_to_send.title = options.title;
        if (options.id   ) things_to_send.id    = options.id;
        var url = get_adr('draft/save/');
        var $saving_msg = show_message(_('Saving')+'...', {duration: 0});
        $.ajax({
            url: url,
            data: things_to_send,
            type: 'POST',
            success: function(response_text) {
                $saving_msg.remove();
                show_message(_('Saved')+'.', {msgclass: 'okmsg', duration: 2000});
                if (/(\d+),(.+)/.exec(response_text)) {
                    var id = RegExp.$1;
                    var actual_title = RegExp.$2;
                    if (options.id) {    // We were overwriting -- remove old version
                        $('#id_drafts option').filter(function() {
                            return $(this).val() == id;
                        }).remove();
                    }
                    else {
                        draft_id = id;
                    }
                    $('#id_drafts option:first').after(
                        $('<option>').attr({value: id}).html(actual_title)
                    );
                }
            },
            error: function(xhr) {
                $saving_msg.remove();
                show_ajax_error(xhr);
            }
        });
    }
    $('a#save-form').live('click', function() {
        var title = prompt(_('Enter template name'));
        title = $.trim(title);
        // retrieve the id of template with this name
        // TODO: to be rewritten (saving interface needs a lift)
        var id = $('#id_drafts option').filter(function(){return $(this).text().indexOf(title+' (') == 0}).val();
        save_preset($('.change-form'), {title:title, id:id});
        return false;
    });
    
    function restore_form(raw, $form) {
        $form.get(0).reset();
        $form.find(':checkbox,:radio').removeAttr('checked');
        $form.find(':text,textarea,:password').val('');
        var form_data = JSON.parse(raw);
        for (var i = 0; i < form_data.length; i++) {
            var form_datum = form_data[i];
            var key = form_datum['name'];
            var val = form_datum['value'];
            var $inputs = $form.find(':input[name='+key+']');
            if (!$inputs || $inputs.length == 0) {
                carp('restore_form: input #'+key+' not found');
                continue;
            }
            var val_esc = val.replace(/\W/g, '\\$1');
            $inputs.filter(':checkbox,:radio').find('[value='+val_esc+']').attr({checked: 'checked'});
            $inputs.filter('option[value='+val_esc+']').attr({selected: 'selected'});
            $inputs.filter(':text,[type=hidden],textarea').val(val);
        }
    }
    function load_preset(id, $form) {
        $.ajax({
            url: get_adr('draft/load/'),
            data: {id:id},
            success: function(form_data) {
                restore_form(form_data, $form);
            },
            error: show_ajax_error
        });
    }
    function load_draft_handler() {
        var id = $(this).val();
        if (!id) return;
        load_preset(id, $('.change-form'));
    }
    function set_load_draft_handler() {
        $('#id_drafts').unbind('change', load_draft_handler).change(load_draft_handler);
    }
    set_load_draft_handler();
    $(document).bind('content_added', set_load_draft_handler);
    
    var autosave_interval;
    function set_autosave_interval() {
        var proceed, target_ids;
        
        if ($('.change-form').length == 0) { // nothing to autosave
             ;;; carp('.change-form not present -- not setting up interval');
             clearInterval(autosave_interval);
             proceed = false;
        }
        else if ( target_ids = $(document).data('injection_storage') ) {
            var target_sel = '#' + target_ids.join(',#');
            if ($('.change-form').closest(target_sel).length) {
                ;;; carp('(re)setting interval for new .change-form');
                proceed = true; // .change-form was just loaded
            }
            else {  // .change-form was there before -- don't touch it
                ;;; carp('.change-form not in loaded stuff -- letting it alone');
                proceed = false;
            }
        }
        else {
            ;;; carp('no injection storage found -- interval reset forced');
            proceed = true;
        }
        
        if (!proceed) return;
        
        if (autosave_interval != undefined) {
            ;;; carp('clearing interval prior to setting new one');
            clearInterval(autosave_interval);
        }
        autosave_interval = setInterval( function() {
            var $change_form = $('.change-form');
            if ($change_form.length == 0) {
                ;;; carp('.change-form disappeared -- clearing interval');
                clearInterval(autosave_interval);
                autosave_interval = undefined;
                return;
            }
            carp('Saving draft '+new Date());
            save_preset($('.change-form'), {id: draft_id});
        }, 60 * 1000 );
    }
    set_autosave_interval();
    $(document).bind('content_added', set_autosave_interval);
})();
// End of drafts and templates


$( function() {
    //// Ajax forms
    
    function get_inputs($form) {    // all except metadata
        return $form.find(':input').filter(function() {
            return ! $(this).parent().is('.form-metadata');
        });
    }
    
    // Validate
    var validations = {
        required: function(input) {
            if ($(input).val()) return false;
            else return _('Field cannot be blank.');
        }
    };
    function show_form_error(input, msg) {
        var $msg = $('<span>').addClass('form-error-msg').text(msg);
        $('label[for='+input.id+']').append($msg);
    }
    /**
     * Automatic class-driven validation.
     * For each :input in the form, find its label and check is some of the label's classes
     * isn't in the validations object. If so, then run the function passing it the input.
     * If it returns *FALSE*, then this input *VALIDATES*.
     * If it returns a true value, it is used as the error message and passed to show_form_error.
     */
    function validate($form) {
        var ok = true;
        get_inputs($form).each( function() {
            var $label = $('label[for='+this.id+']');
            $label.find('span.form-error-msg').remove();
            var classes = $label.attr('className').split(/\s+/);
            for (var i = 0; i < classes.length; i++) {
                var cl = classes[i];
                if ($.isFunction(validations[ cl ])) {
                    var err = validations[ cl ](this);
                    if (err) {
                        show_form_error(this, err);
                        ok = false;
                    }
                }
            }
        });
        return ok;
    }
    
    // Submit event
    function ajax_submit($form) {
        if (!$form.jquery) $form = $($form);
        if ( ! validate($form) ) return false;
        var action =  $form.attr('action');
        var method = ($form.attr('method') || 'POST').toUpperCase();
        var $meta = $form.find('.form-metadata:first');
        var $success =  $meta.find('input[name=success]');
        var $error   =  $meta.find('input[name=error]');
        var success, error;
        if ($success && $success.length) {
            success = function(data) { $success.get(0).onchange(data); };
        }
        else {
            success = function(data) { show_message(data, {msgclass: 'okmsg'}); };
        }
        if ($error && $error.length) {
            error = function(xhr, st) { $error.get(0).onchange(xhr, st); };
        }
        else {
            error = show_ajax_error;
        }
        var $inputs = get_inputs($form);
        var data = $inputs.serialize();
        $form.get(0).reset();
        $.ajax({
            url: action,
            type: method,
            data: data,
            success: success,
            error:   error
        });
        return false;
    }
    window.ajax_submit = ajax_submit;
    
    // Submit button
    $('.ajax-form a.ok').live('click', function(evt) {
        if (evt.which != 1) return true;
        var $form = $(this).closest('.ajax-form');
        ajax_submit($form);
        return false;
    });
    
    // Reset button
    $('.ajax-form a.eclear').live('click', function(evt) {
        $(this).closest('form').get(0).reset();
        return false;
    });
    //// End of ajax forms
    
    // Packing and unpacking filter list. To be removed when filters are reimplemented.
    $('#filters :header').live('click', function(evt) {
        if (evt.which != 1) return true;
        $(this).next(':first').filter('ul').slideToggle('slow');
    });
    
    // Re-initialization of third party libraries
    $(document).bind('content_added', function() {
        try {
            DateTimeShortcuts.admin_media_prefix = MEDIA_URL;
            DateTimeShortcuts.init();
        } catch(e) { if (e.name != 'ReferenceError') carp(e); }
    });
    
    // Initialization of JavaScripts
    $(document).bind('media_loaded', function() {
        var loaded_media = $(document).data('loaded_media');
        if (loaded_media[ MEDIA_URL + 'js/admin/DateTimeShortcuts.js' ]) {
            DateTimeShortcuts.admin_media_prefix = MEDIA_URL;
            DateTimeShortcuts.init();
        }
        delete loaded_media[ MEDIA_URL + 'js/admin/DateTimeShortcuts.js' ];
    });
    
    // The search button should send us to an address according to the thing selected in the select
    function do_search() {
        var $form = $('#search-form');
        var option = $form.find('select[name=action] option[selected]').val();
        if (!option) return false;
        var search_terms = $form.find('input[name=q]').val();
        var url = option + '?q=' + escape(search_terms);
        adr(url);
        return false;
    }
    $('#search-form a.search.btn').live('click', do_search);
    function search_on_enter(evt) {
        if (evt.keyCode == CR || evt.keyCode == LF) {
            do_search();
            return false;
        }
    }
    $('#search-form input[name=q]'      ).live('keypress', search_on_enter);
    $('#search-form select[name=action]').live('keypress', search_on_enter);
});

function show_message(message, options) {
    if (!options) options = {};
    var duration = (options.duration == undefined) ? 5000 : options.duration;
    var $span = $('<span></span>').html(message);
    var $msg = $('<br />').add($span);
    if (options.msgclass) $span.addClass(options.msgclass);
    $('#opmsg').append($msg);
    if (duration) setTimeout(function() {
        $span.fadeOut('slow', function(){ $msg.remove(); });
    }, duration);
    return $msg;
}


// The 'loading...' message
//                How many things need the loading message shown concurrently
var $LOADING_MSG, LOADING_CNT = 0;
function show_loading() {
    LOADING_CNT++;
    if ($LOADING_MSG) return;
    $LOADING_MSG = show_message(_('loading...'), {duration:0});
}
function hide_loading() {
    if ($LOADING_MSG) $LOADING_MSG.remove();
    LOADING_CNT = 0;
    $LOADING_MSG = undefined;
}
function dec_loading() {
    if (--LOADING_CNT <= 0) {
        LOADING_CNT = 0;
        hide_loading();
    }
}

function show_ajax_error(xhr) {
    var message;
    if (xhr.responseText.indexOf('<!DOCTYPE') >= 0) {
        message = _('Request failed')+' ('+xhr.status+': '+_(xhr.statusText)+')';
    }
    else {
        message = xhr.responseText;
    }
    show_message(message, {msgclass: 'errmsg'});
}
