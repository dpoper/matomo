// # RealTimeMap

window.RealTimeMap = {};


RealTimeMap.run = function(config) {

    var map = $K.map('#RealTimeMap_map'),
        main = $('#RealTimeMap_container'),
        worldTotalVisits = 0,
        maxVisits = 100,
        width = main.width(),
        scale = width / 300,
        lastTimestamp = -1,
        lastVisits = [],
        visitSymbols,
        oldest,
        now;

    window._liveMap = map;
    RealTimeMap.config = config;

    function _reportParams() {
        var params = $.extend(RealTimeMap.reqParams, {
            module: 'API',
            method: 'Live.getLastVisitsDetails',
            filter_limit: maxVisits,
            showColumns: ['latitude','longitude','actions','lastActionTimestamp',
                'visitLocalTime','city','country','referrerType','referrerName',
                'referrerTypeName','browserIcon','operatingSystemIcon',
                'countryFlag','idVisit'].join(','),
            minTimestamp: lastTimestamp,
            date: 'today'
        });
        return params;
    }

    /*
     * updateMap is called by renderCountryMap() and renderWorldMap()
     */
    function _updateMap(svgUrl, callback) {
        map.loadMap(config.svgBasePath + svgUrl, function() {
            map.clear();
            onResize();
            callback();
            $('.ui-tooltip').remove(); // remove all existing tooltips
        }, { padding: -3});
    }

    /*
     * resizes the map to widget dimensions
     */
    function onResize() {
        var ratio, w, h;
        ratio = map.viewAB.width / map.viewAB.height;
        w = map.container.width();
        h = w / ratio;
        map.container.height(h-2);
        map.resize(w, h);

        if (w < 355) $('.tableIcon span').hide();
        else $('.tableIcon span').show();
    }

    /*
     * to ensure that onResize is not called a hundred times
     * while resizing the browser window, this functions
     * makes sure to only call onResize at the end
     */
    function onResizeLazy() {
        clearTimeout(RealTimeMap._resizeTimer);
        RealTimeMap._resizeTimer = setTimeout(onResize, 300);
    }

    function age(r) {
        var o = (r.lastActionTimestamp - oldest) / (now - oldest);
        return o;
    }

    function visitTooltip(r) {
        var ds = now - r.lastActionTimestamp;
        var ico = function(src) { return '<img src="'+src+'" alt="" class="icon" />&nbsp;'; },
            val = function(val) { return '<b>'+Math.round(val)+'</b>'; };
        return '<h3>'+r.city+' / '+r.country+'</h3>'+
            // icons
            ico(r.countryFlag)+ico(r.browserIcon)+ico(r.operatingSystemIcon)+'<br/>'+
            // time of visit
            (ds < 90 ? RealTimeMap._.seconds_ago.replace('%s', '<b>'+val(ds)+'</b>')
            : ds < 5400 ? RealTimeMap._.minutes_ago.replace('%s', '<b>'+val(ds/60)+'</b>')
            : ds < 129600 ? RealTimeMap._.hours_ago.replace('%s', '<b>'+val(ds/3600)+'</b>')
            : RealTimeMap._.days_ago.replace('%s', '<b>'+val(ds/86400)+'</b>'))+'<br/>'+
            // either from or direct
            (r.referrerType == "direct" ? r.referrerTypeName :
            RealTimeMap._.from + ': '+r.referrerName) + '<br />' +
            // local time
            RealTimeMap._.local_time+': '+r.visitLocalTime;
    }

    function visitRadius(r) {
        return 3 * scale * Math.pow(age(r),4) + 2.5;
    }

    function visitSymbolAttrs(r) {
        return {
            fill: chroma.hsl(42 * age(r), Math.sqrt(age(r)), 0.50 - (1-age(r))*0.45),
            'fill-opacity': Math.pow(age(r),2),
            'stroke-opacity': Math.pow(age(r),1.7),
            stroke: '#fff',
            'stroke-width': age(r),
            r: visitRadius(r)
        };
    }

    function highlightVisit(r) {
        $('#visitsLive li#'+r.idVisit + ' .datetime')
            .css('background', 'yellow')
            .animate({ background: '#E4E2D7' });
    }

    function refreshVisits(firstRun) {
        $.ajax({
            url: 'index.php',
            type: 'POST',
            data: _reportParams()
        }).done(function(report) {

            now = new Date().getTime() / 1000;

            if (firstRun) {
                // init symbol group
                visitSymbols = map.addSymbols({
                    data: [],
                    type: Kartograph.Bubble,
                    sortBy: function(r) { return r.lastActionTimestamp; },
                    radius: visitRadius,
                    location: function(r) { return [r.longitude, r.latitude]; },
                    attrs: visitSymbolAttrs,
                    tooltip: visitTooltip,
                    mouseenter: highlightVisit
                });
            }

            if (report.length) {

                // filter results without location
                report = report.filter(function(r) {
                    return r.latitude !== null;
                });

                lastVisits = [].concat(report).concat(lastVisits).slice(0, maxVisits);
                oldest = lastVisits[lastVisits.length-1].lastActionTimestamp;

                // remove symbols that are too old
                //console.log('before', $('circle').length, visitSymbols.symbols.length);
                var _removed = 0;
                visitSymbols.remove(function(r) {
                    if (r.lastActionTimestamp < oldest) _removed++;
                    return r.lastActionTimestamp < oldest;
                });
                //console.log('removed',_removed, 'now', $('circle').length);

                // update symbols that remain
                visitSymbols.update({
                    attrs: visitSymbolAttrs
                });

                //console.log('updated', $('circle').length);

                // add new symbols
                var newSymbols = [];
                $.each(report, function(i, r) {
                    if (r.latitude !== null) newSymbols.push(visitSymbols.add(r));
                });

                //console.log('added', newSymbols.length, visitSymbols.symbols.length, $('circle').length);

                lastTimestamp = report[0].lastActionTimestamp;

                visitSymbols.layout().render();

                //console.log('rendered', visitSymbols.symbols.length, $('circle').length);

                $.each(newSymbols, function(i, s) {
                    if (i>10) return false;
                    s.path.hide(); // hide new symbol at first
                    setTimeout(function() {
                        var c = map.paper.circle().attr(s.path.attrs);
                        c.insertBefore(s.path);
                        c.attr({ fill: false });
                        c.animate({ r: c.attrs.r*3, 'stroke-width': 5 * scale, opacity: 0 }, 2500,
                            'linear', function() { c.remove(); });
                        var col = s.path.attrs.fill,
                            rad = s.path.attrs.r;
                        s.path.show();
                        s.path.attr({ fill: '#fdb', r: 0.1, opacity: 1 });
                        s.path.animate({ fill: col, r: rad }, 700, 'bounce');
                    }, 1000 * (s.data.lastActionTimestamp - now) + config.liveRefreshAfterMs);
                });

                //console.log('animated', visitSymbols.symbols.length, $('circle').length);
            }

        });
    }

    _updateMap('world.svg', function() {
        $('#widgetRealTimeMapliveMap .loadingPiwik, #RealTimeMap .loadingPiwik').hide();

        map.addLayer('countries', {
            styles: {
                fill: '#aa9',
                stroke: '#ffffff',
                'stroke-width': 0.2
            }
        });

        var lastVisitId = -1,
            lastReport = [];

        refreshVisits(true);
        setInterval(refreshVisits, config.liveRefreshAfterMs);
    });

    $(window).resize(onResizeLazy);
};

/*
 Color animation jQuery-plugin
 http://www.bitstorm.org/jquery/color-animation/
 Copyright 2011 Edwin Martin <edwin@bitstorm.org>
 Released under the MIT and GPL licenses.
*/
(function(d){function i(){var b=d("script:first"),a=b.css("color"),c=false;if(/^rgba/.test(a))c=true;else try{c=a!=b.css("color","rgba(0, 0, 0, 0.5)").css("color");b.css("color",a)}catch(e){}return c}function g(b,a,c){var e="rgb"+(d.support.rgba?"a":"")+"("+parseInt(b[0]+c*(a[0]-b[0]),10)+","+parseInt(b[1]+c*(a[1]-b[1]),10)+","+parseInt(b[2]+c*(a[2]-b[2]),10);if(d.support.rgba)e+=","+(b&&a?parseFloat(b[3]+c*(a[3]-b[3])):1);e+=")";return e}function f(b){var a,c;if(a=/#([0-9a-fA-F]{2})([0-9a-fA-F]{2})([0-9a-fA-F]{2})/.exec(b))c=
[parseInt(a[1],16),parseInt(a[2],16),parseInt(a[3],16),1];else if(a=/#([0-9a-fA-F])([0-9a-fA-F])([0-9a-fA-F])/.exec(b))c=[parseInt(a[1],16)*17,parseInt(a[2],16)*17,parseInt(a[3],16)*17,1];else if(a=/rgb\(\s*([0-9]{1,3})\s*,\s*([0-9]{1,3})\s*,\s*([0-9]{1,3})\s*\)/.exec(b))c=[parseInt(a[1]),parseInt(a[2]),parseInt(a[3]),1];else if(a=/rgba\(\s*([0-9]{1,3})\s*,\s*([0-9]{1,3})\s*,\s*([0-9]{1,3})\s*,\s*([0-9\.]*)\s*\)/.exec(b))c=[parseInt(a[1],10),parseInt(a[2],10),parseInt(a[3],10),parseFloat(a[4])];return c}
d.extend(true,d,{support:{rgba:i()}});var h=["color","backgroundColor","borderBottomColor","borderLeftColor","borderRightColor","borderTopColor","outlineColor"];d.each(h,function(b,a){d.fx.step[a]=function(c){if(!c.init){c.a=f(d(c.elem).css(a));c.end=f(c.end);c.init=true}c.elem.style[a]=g(c.a,c.end,c.pos)}});d.fx.step.borderColor=function(b){if(!b.init)b.end=f(b.end);var a=h.slice(2,6);d.each(a,function(c,e){b.init||(b[e]={a:f(d(b.elem).css(e))});b.elem.style[e]=g(b[e].a,b.end,b.pos)});b.init=true}})(jQuery);