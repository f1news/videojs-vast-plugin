(function(window, vjs, vast) {
  'use strict';

  var extend = function(obj) {
    var arg, i, k;
    for (i = 1; i < arguments.length; i++) {
      arg = arguments[i];
      for (k in arg) {
        if (arg.hasOwnProperty(k)) {
          obj[k] = arg[k];
        }
      }
    }
    return obj;
  },

  defaults = {
    // seconds before skip button shows, negative values to disable skip button altogether
    skip: 5
  },

  Vast = function (player, settings) {

    // return vast plugin
    return {
      createSourceObjects: function (media_files) {
        var sourcesByFormat = {}, i, j, tech;
        var techOrder = player.options().techOrder;
        for (i = 0, j = techOrder.length; i < j; i++) {
          var techName = techOrder[i].charAt(0).toUpperCase() + techOrder[i].slice(1);
          tech = window.videojs[techName];

          // Check if the current tech is defined before continuing
          if (!tech) {
            continue;
          }

          // Check if the browser supports this technology
          if (tech.isSupported()) {
            // Loop through each source object
            for (var a = 0, b = media_files.length; a < b; a++) {
              var media_file = media_files[a];
              var source = {type:media_file.mimeType, src:media_file.fileURL};
              // Check if source can be played with this technology
              if (tech.canPlaySource(source)) {
                if (sourcesByFormat[techOrder[i]] === undefined) {
                  sourcesByFormat[techOrder[i]] = [];
                }
                sourcesByFormat[techOrder[i]].push({
                  type:media_file.mimeType,
                  src: media_file.fileURL,
                  width: media_file.width,
                  height: media_file.height
                });
              }
            }
          }
        }
        // Create sources in preferred format order
        var sources = [];
        for (j = 0; j < techOrder.length; j++) {
          tech = techOrder[j];
          if (sourcesByFormat[tech] !== undefined) {
            for (i = 0; i < sourcesByFormat[tech].length; i++) {
              sources.push(sourcesByFormat[tech][i]);
            }
          }
        }
        return sources;
      },

      getPreroll: function () {

        // query vast url given in settings
        vast.client.get(settings.preroll, function(response) {
          if (response) {
            // we got a response, deal with it
            for (var adidx = 0; adidx < response.ads.length; adidx++) {
              var ad = response.ads[adidx];
              player.vast.companion = undefined;
              for (var creaIdx = 0; creaIdx < ad.creatives.length; creaIdx++) {
                  var creative = ad.creatives[creaIdx], foundCreative = false, foundCompanion = false;
                  if (creative.type === "linear" && !foundCreative) {
              
                  if (creative.mediaFiles.length) {
                      player.vast.sources = player.vast.createSourceObjects(creative.mediaFiles);

                    if (!player.vast.sources.length) {
                      player.trigger('adscanceled');
                      return;
                    }
                    player.preroll = {};
                    player.preroll.vasttracker = new vast.tracker(ad, creative);

                    foundCreative = true;
                  }

                } else if (creative.type === "companion" && !foundCompanion) {

                  player.vast.companion = creative;

                  foundCompanion = true;

                }
              }

              if (player.preroll.vasttracker) {
                // vast tracker and content is ready to go, trigger event
                player.trigger('vast-ready');
                break;
              } else {
                // inform ad server we can't find suitable media file for this ad
                vast.util.track(ad.errorURLTemplates, {ERRORCODE: 403});
              }
            }
          }

          if (!player.preroll.vasttracker) {
            // no pre-roll, start video
            player.trigger('adscanceled');
          }
        });
      },


      setupEvents: function() {

        var errorOccurred = false,
            canplayFn = function() {
              player.preroll.vasttracker.load();
            },
            timeupdateFn = function() {
              if (isNaN(player.preroll.vasttracker.assetDuration)) {
                player.preroll.vasttracker.assetDuration = player.duration();
              }
              player.preroll.vasttracker.setProgress(player.currentTime());
            },
            pauseFn = function() {
              player.preroll.vasttracker.setPaused(true);
              player.one('play', function(){
                player.preroll.vasttracker.setPaused(false);
              });
            },
            errorFn = function() {
              // Inform ad server we couldn't play the media file for this ad
              vast.util.track(player.preroll.vasttracker.ad.errorURLTemplates, {ERRORCODE: 405});
              errorOccurred = true;
              player.trigger('ended');
            };

        player.on('canplay', canplayFn);
        player.on('timeupdate', timeupdateFn);
        player.on('pause', pauseFn);
        player.on('error', errorFn);

        player.one('vast-preroll-removed', function() {
          player.off('canplay', canplayFn);
          player.off('timeupdate', timeupdateFn);
          player.off('pause', pauseFn);
          player.off('error', errorFn);
          if (!errorOccurred) {
            player.preroll.vasttracker.complete();
          }
        });
      },

      preroll: function() {
        player.ads.startLinearAdMode();
        player.vast.showControls = player.controls();
        if (player.vast.showControls) {
          player.controls(false);
        }

        // load linear ad sources and start playing them
        player.src(player.vast.sources);

        var clickthrough;
        if (player.preroll.vasttracker.clickThroughURLTemplate) {
          clickthrough = vast.util.resolveURLTemplates(
            [player.preroll.vasttracker.clickThroughURLTemplate],
            {
              CACHEBUSTER: Math.round(Math.random() * 1.0e+10),
              CONTENTPLAYHEAD: player.preroll.vasttracker.progressFormated()
            }
          )[0];
        }
        var blocker = window.document.createElement("a");
        blocker.className = "vast-blocker";
        blocker.href = clickthrough || "#";
        blocker.target = "_blank";
        blocker.onclick = function() {
          if (player.paused()) {
            player.play();
            return false;
          }
          var clicktrackers = player.preroll.vasttracker.clickTrackingURLTemplate;
          if (clicktrackers) {
            player.preroll.vasttracker.trackURLs([clicktrackers]);
          }
          player.trigger("adclick");
        };
        player.vast.blocker = blocker;
        player.el().insertBefore(blocker, player.controlBar.el());

        var skipButton = window.document.createElement("div");
        skipButton.className = "vast-skip-button";
        if (settings.skip < 0) {
          skipButton.style.display = "none";
        }
        player.vast.skipButton = skipButton;
        player.el().appendChild(skipButton);

        player.on("timeupdate", player.vast.timeupdate);

        skipButton.onclick = function(e) {
          if((' ' + player.vast.skipButton.className + ' ').indexOf(' enabled ') >= 0) {
            player.preroll.vasttracker.skip();
            player.vast.tearDown();
          }
          if(window.Event.prototype.stopPropagation !== undefined) {
            e.stopPropagation();
          } else {
            return false;
          }
        };

        player.vast.setupEvents();

        player.one('ended', player.vast.tearDown);

        player.trigger('vast-preroll-ready');
      },

      tearDown: function() {
        // remove preroll buttons
        player.vast.skipButton.parentNode.removeChild(player.vast.skipButton);
        player.vast.blocker.parentNode.removeChild(player.vast.blocker);

        // remove vast-specific events
        player.off('timeupdate', player.vast.timeupdate);
        player.off('ended', player.vast.tearDown);

        // end ad mode
        player.ads.endLinearAdMode();

        // show player controls for video
        if (player.vast.showControls) {
          player.controls(true);
        }

        player.trigger('vast-preroll-removed');
      },

      timeupdate: function(e) {
        player.loadingSpinner.el().style.display = "none";
        var timeLeft = Math.ceil(settings.skip - player.currentTime());
        if(timeLeft > 0) {
          player.vast.skipButton.innerHTML = "Skip in " + timeLeft + "...";
        } else {
          if((' ' + player.vast.skipButton.className + ' ').indexOf(' enabled ') === -1){
            player.vast.skipButton.className += " enabled";
            player.vast.skipButton.innerHTML = "Skip";
          }
        }
      }
    };

  },

  vastPlugin = function(options) {
    var player = this;
    var settings = extend({}, defaults, options || {});

    // check that we have the ads plugin
    if (player.ads === undefined) {
      window.console.error('vast video plugin requires videojs-contrib-ads, vast plugin not initialized');
      return null;
    }

    // set up vast plugin, then set up events here
    player.vast = new Vast(player, settings);

    player.on('vast-ready', function () {
      // vast is prepared with content, set up ads and trigger ready function
      player.trigger('adsready');
    });

    player.on('vast-preroll-ready', function () {
      // start playing preroll, note: this should happen this way no matter what, even if autoplay
      //  has been disabled since the preroll function shouldn't run until the user/autoplay has
      //  caused the main video to trigger this preroll function
      player.play();
    });

    player.on('vast-preroll-removed', function () {
      // preroll done or removed, start playing the actual video
      player.play();
    });

    player.on('contentupdate', function(){
      // videojs-ads triggers this when src changes
      player.vast.getPreroll();
    });

    player.on('readyforpreroll', function() {
      // if we don't have a vast url, just bail out
      if (!settings.preroll) {
        player.trigger('adscanceled');
        return null;
      }
      // set up and start playing preroll
      player.vast.preroll();
    });

    // make an ads request immediately so we're ready when the viewer hits "play"
    if (player.currentSrc()) {
      player.vast.getPreroll();
    }

    // return player to allow this plugin to be chained
    return player;
  };

  vjs.plugin('vast', vastPlugin);

}(window, videojs, DMVAST));
