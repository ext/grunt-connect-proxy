/*
 * grunt-connect-proxy
 * https://github.com/drewzboto/grunt-connect-proxy
 *
 * Copyright (c) 2013 Drewz
 * Licensed under the MIT license.
 */

const utils = require("../lib/utils");

module.exports = function(grunt) {
    grunt.registerTask(
        "configureProxies",
        "Configure any specified connect proxies.",
        function(config) {
            // setup proxy
            const httpProxy = require("http-proxy");
            let proxyOption;
            let proxyOptions = [];
            const validateProxyConfig = function(proxyOption) {
                if (
                    proxyOption.host === undefined ||
                    proxyOption.context === undefined
                ) {
                    grunt.log.error(
                        "Proxy missing host or context configuration"
                    );
                    return false;
                }
                if (proxyOption.https && proxyOption.port === 80) {
                    grunt.log.warn(
                        `Proxy for ${proxyOption.context} is using https on port 80. Are you sure this is correct?`
                    );
                }
                return true;
            };

            utils.reset();
            utils.log = grunt.log;
            if (config) {
                const connectOptions = grunt.config(`connect.${config}`) || [];
                if (
                    typeof connectOptions.appendProxies === "undefined" ||
                    connectOptions.appendProxies
                ) {
                    proxyOptions = proxyOptions.concat(
                        grunt.config("connect.proxies") || []
                    );
                }
                proxyOptions = proxyOptions.concat(
                    connectOptions.proxies || []
                );
            } else {
                proxyOptions = proxyOptions.concat(
                    grunt.config("connect.proxies") || []
                );
            }
            proxyOptions.forEach(function(proxy) {
                proxyOption = Object.assign(
                    {
                        port: proxy.https ? 443 : 80,
                        https: false,
                        secure: true,
                        xforward: false,
                        rules: [],
                        errorHandler: function() {},
                        ws: false,
                    },
                    proxy
                );
                if (validateProxyConfig(proxyOption)) {
                    proxyOption.rules = utils.processRewrites(
                        proxyOption.rewrite
                    );
                    utils.registerProxy({
                        server: httpProxy
                            .createProxyServer({
                                target: utils.getTargetUrl(proxyOption),
                                secure: proxyOption.secure,
                                xfwd: proxyOption.xforward,
                                changeOrigin: proxyOption.changeOrigin,
                                headers: {
                                    host: proxyOption.host,
                                },
                                hostRewrite: proxyOption.hostRewrite,
                            })
                            .on("error", function(err) {
                                grunt.log.error("Proxy error: ", err.code);
                            }),
                        config: proxyOption,
                    });
                    grunt.log.writeln(
                        `Proxy created for: ${proxyOption.context} to ${proxyOption.host}:${proxyOption.port}`
                    );
                }
            });
        }
    );
};
