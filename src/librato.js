module.exports = function(robot) {
  var libratoAuth = function() {
    var user = process.env.NESTOR_LIBRATO_USER;
    var pass = process.env.NESTOR_LIBRATO_TOKEN;
    var auth = 'Basic ' + new Buffer(user + ':' + pass).toString('base64');

    return auth;
  };

  var parseTimePeriod = function(time) {
    var matchData = /(\d+)?\s*(second|minute|hour|day|week)s?/.exec(time);
    if (!matchData[2]) {
      return;
    }
    var amount = matchData[1] ? parseInt(matchData, 10) : 1;
    return amount * (function() {
      switch (matchData[2]) {
        case 'second':
          return 1;
        case 'minute':
          return 60;
        case 'hour':
          return 60 * 60;
        case 'day':
          return 60 * 60 * 24;
        case 'week':
          return 60 * 60 * 24 * 7;
      }
    })();
  };

  var getSnapshot = function(snapshotUrl, jobUrl, msg, done) {
    robot.http(jobUrl).headers({
      Authorization: libratoAuth(),
      Accept: 'application/json'
    }).get()(function(err, res, body) {
      if (res.statusCode == 200) {
        var job = JSON.parse(body);
        if (job.state == 'complete') {
          robot.http(snapshotUrl).headers({
            Authorization: libratoAuth(),
            Accept: 'application/json'
          }).get()(function(err, res, body) {
            if(res.statusCode == 200) {
              var json = JSON.parse(body);
              msg.reply(json['image_href'], done);
            } else {
              msg.reply("Unable to get snapshot from librato :(\nStatus Code: " + res.statusCode + "\nBody:\n\n" + body, done);
            }
          });
        } else {
          setTimeout((function() {
            getSnapshot(snapshotUrl, jobUrl, msg, done);
          }), 100);
        }
      } else {
        msg.reply("Unable to get snapshot from librato :(\nStatus Code: " + res.statusCode + "\nBody:\n\n" + body, done);
      }
    });
  };

  var processChartResponse = function(chart, source, timePeriod, msg, done) {
    var timePeriodInSeconds = parseTimePeriod(timePeriod);
    if (!timePeriodInSeconds) {
      msg.reply("Sorry, I couldn't understand the time period " + timePeriod + ".\nTry something like '[<number> ]<second|minute|hour|day|week>s'", done);
      return;
    }

    var data = JSON.stringify({
      subject: {
        chart: {
          id: chart.id,
          sources: [source],
          type: 'line',
        }
      },
      duration: timePeriodInSeconds
    });

    robot.http("https://metrics-api.librato.com/v1/snapshots").headers({
      Authorization: libratoAuth(),
      Accept: 'application/json',
      'Content-Type': 'application/json'
    }).post(data)(function(err, res, body) {
      if (res.statusCode == 201) {
        var json = JSON.parse(body);
        msg.reply(json['image_href'], done);
      } else if(res.statusCode == 202) {
        var json = JSON.parse(body);
        getSnapshot(json['href'], json['job_href'], msg, done);
      } else {
        msg.reply("Unable to create snapshot from librato :(\nStatus Code: " + res.statusCode + "\nBody:\n\n" + body, done);
      }
    });
  };

  var getSpaces = function(cb) {
    robot.http("https://metrics-api.librato.com/v1/spaces").headers({
      Authorization: libratoAuth(),
      Accept: 'application/json'
    }).get()(function(err, res, body) {
      if(res.statusCode == 200) {
        json = JSON.parse(body);
        cb(json['spaces']);
      } else {
        cb(null);
      }
    });
  };

  var getCharts = function(space, cb) {
    robot.http("https://metrics-api.librato.com/v1/spaces/" + space.id + "/charts").headers({
      Authorization: libratoAuth(),
      Accept: 'application/json'
    }).get()(function(err, res, body) {
      if(res.statusCode == 200) {
        json = JSON.parse(body);
        cb(json);
      } else {
        cb(null);
      }
    });
  };

  robot.respond(/librato spaces$/, { suggestions: ["librato spaces"] }, function(msg, done) {
    getSpaces(function(spaces) {
      if (spaces == null) {
        msg.reply("Couldn't find any spaces on Librato", done);
      } else {
        names = spaces.map(function(s) {
          return "* " + s.name;
        });
        msg.send(names, done);
      }
    });
  });

  robot.respond(/librato charts (.*)$/, { suggestions: ["librato charts <space-name>"] }, function(msg, done) {
    var chartName = msg.match[1];
    getSpaces(function(spaces) {
      var chosenSpace = null;

      for (var i in spaces) {
        var space = spaces[i];
        if(space.name.toLowerCase() == chartName.trim().toLowerCase()) {
          chosenSpace = space;
        }
      }

      if(chosenSpace == null) {
        msg.reply("Couldn't find this space: " + msg.match[1], done);
      } else {
        getCharts(chosenSpace, function(charts) {
          names = charts.map(function(c) {
            return "* " + c.name;
          });
          msg.send(names, done);
        });
      }
    });
  });

  robot.respond(/graph me ([\w\.:\- ]+?)\s*(?:over the (?:last|past)? )?(\d+ (?:second|minute|hour|day|week)s?)?(?: source (.+))?(?: space (.+))?$/i, { suggestions: ["graph me <chart-name> [time period] [source <source>] [space <space>]"] }, function(msg, done) {
    var chartName = msg.match[1];
    var timePeriod = msg.match[2] || 'hour';
    var source = msg.match[3] || '*';
    var spaceName = msg.match[4] || process.env.NESTOR_LIBRATO_DEFAULT_SPACE;

    if(spaceName == null || spaceName == "") {
      msg.reply("You need to specify a space or set a default space with the NESTOR_LIBRATO_DEFAULT_SPACE environment variable", done);
      return;
    }

    getSpaces(function(spaces) {
      var chosenSpace = null;

      for (var i in spaces) {
        var space = spaces[i];
        if(space.name.toLowerCase() == spaceName.trim().toLowerCase()) {
          chosenSpace = space;
        }
      }

      if(chosenSpace == null) {
        msg.reply("Couldn't find this space: " + spaceName, done);
      } else {
        getCharts(chosenSpace, function(charts) {
          var chosenChart = null;

          for (var i in charts) {
            var chart = charts[i];
            if(chart.name.toLowerCase() == chartName.trim().toLowerCase()) {
              chosenChart = chart;
            }
          }

          if(chosenChart == null) {
            msg.reply("Couldn't find this chart: " + chartName, done);
          } else {
            processChartResponse(chosenChart, source, timePeriod, msg, done);
          }
        });
      }
    });
  });
};
