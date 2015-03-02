"use strict";

/**
 * NOTE:
 * I am not happy with the xml parser implementation,
 * imho there should be an better implementation than xml2js.
 *
 * xml2js: makes ugly js objects
 * elementtree: makes beautiful objects, but was last updated a year ago and has outdated dependencies
 *
 * xml-stream: looks good, need to test a bit. good for large xml files. last update Oct 5, 2014
 *
 * research related to xml parser modules in node.js was sobering
 * TODO: write own xml parser module for node.js and maintain it more than half a year :)
 *
 */

/**
 *
 * @type {exports}
 */

var when = require('when');
var mongoose = require('mongoose');
var Calendar = require('./db').Calendar;
var Event = require('./db').Event;
var caldavReceiver = require('./receiver');
var xmlParser = require('./lib/xmlParser');
var util = require('util');

var calendar = {}; // holds calendar object (request)

var calResponse = {
    props: {
        href: null,
        name: null,
        ctag: null
    },
    events: {
        'new': [],
        'modified': [],
        'unchanged': []
    }
}; // object we want to work with

/**
 *
 * @param calendar
 * @returns {Promise|*}
 */
function getCalendarFromDb(calendar) {

    return when.promise(function (resolve, reject) {

        var query = Calendar.where({
            href: calendar.href,
            name: calendar.name
        });

        query.findOne(function (error, resCalendar) {

            if (error) {
                reject(error);
                return;
            }

            resolve(resCalendar);
        });
    });
}

/**
 *
 * @param event
 * @returns {Promise|*}
 */
function checkEventAgainstDb(event) {

    return when.promise(function (resolve, reject) {

        var query = Event.where({
            ics: event.ics,
            etag: event.etag
        });

        query.findOne(function (error, resEvent) {

            if (error) {
                reject(error);
                return;
            }

            resolve(resEvent);
        });
    }).then(function (resEvent) {

        if (resEvent === null) calResponse.events['new'].push(event);
        else if (resEvent.ctag === event.ctag) calResponse.events['unchanged'].push(event);
        else if (resEvent.ctag !== event.ctag) calResponse.events['modified'].push(event);

        return calResponse;
    });
}

// start by fetching the calendar, looking for a modified ctag
caldavReceiver('changed_cal', 'PROPFIND', 0)
    .then(function (response) {

        calendar = xmlParser.parseCalendarMultistatus(response);
        return getCalendarFromDb(calendar);

    }).then(function (dbCalendar) {

        // what are we doing now? compare the calendar objects

        // 1) if calendar is new or ctag has changed return calendar object
        if (dbCalendar === null || calendar.ctag !== dbCalendar.ctag) return calendar;

        // 2) do nothing, if ctags are equal
        if (dbCalendar.ctag === calendar.ctag) return null;

        throw ('Error: no condition applied - this is a logic error.')

    }).then(function (calendar_object) {

        // if value equals null, there is no action required
        if (calendar_object === null) return null;

        // otherwise receive events' etags
        // and construct calendar response
        calResponse.props.href = calendar_object.href;
        calResponse.props.ctag = calendar_object.ctag;
        calResponse.props.name = calendar_object.name;

        // receive events' ctags and filename.ics (used as id)
        return caldavReceiver('changed', 'REPORT', 1);

    }).then(function (response) {

        if (response === null) return null;

        var events = xmlParser.parseEventsMultistatus(response);
        return when.map(events, checkEventAgainstDb);

    }).done(function () {

        /**
         * at the end we want to get an calendar object which looks like
         *  { props:
         *      { href: 'calendar uri',
         *        name: 'calendar displayname',
         *        ctag: 'calendars ctag;
         *      },
         *    events:
         *      { new: [ array with new event items ],
         *        modified: [ array with modified items ],
         *        unchanged: [ array with unchanged items]
         *      } }
         *
         * There should only be an filled object if there is something to do (!)
         *
         * NOTE: I think we need the 'unchanged' items to differ from items
         * we later want to delete.
         *
         **/

        // TODO: emit events or something else because we want delegate db actions to another handler
        // for now I am happy with an console.log
        console.log(util.inspect(calResponse, {depth: null, colors: true}));

        mongoose.disconnect();

    }, function (error) {
        throw new Error(error);
    }
);