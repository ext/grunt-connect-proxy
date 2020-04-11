const utils = module.exports;
const grunt = require("grunt");
let proxies = [];
const rewrite = function (req) {
    return function (rule) {
        if (rule.from.test(req.url)) {
            req.url = req.url.replace(rule.from, rule.to);
        }
    };
};

utils.registerProxy = function (proxy) {
    proxies.push(proxy);
};

utils.proxies = function () {
    return proxies;
};

utils.reset = function () {
    proxies = [];
};

utils.validateRewrite = function (rule) {
    if (
        !rule ||
        typeof rule.from === "undefined" ||
        typeof rule.to === "undefined" ||
        typeof rule.from !== "string" ||
        (typeof rule.to !== "string" && typeof rule.to !== "function")
    ) {
        return false;
    }
    return true;
};

utils.processRewrites = function (rewrites) {
    const rules = [];

    Object.keys(rewrites || {}).forEach(function (from) {
        const rule = {
            from: from,
            to: rewrites[from],
        };

        if (utils.validateRewrite(rule)) {
            rule.from = new RegExp(rule.from);
            rules.push(rule);
            grunt.log.writeln(
                `Rewrite rule created for: [${rule.from} -> ${rule.to}].`
            );
        } else {
            grunt.log.error("Invalid rule");
        }
    });

    return rules;
};

utils.matchContext = function (context, url) {
    let negativeContexts;
    let contexts = context;
    if (!Array.isArray(contexts)) {
        contexts = [contexts];
    }
    const positiveContexts = contexts.filter(function (c) {
        return c.charAt(0) !== "!";
    });
    negativeContexts = contexts.filter(function (c) {
        return c.charAt(0) === "!";
    });
    // Remove the '!' character from the contexts
    negativeContexts = negativeContexts.map(function (c) {
        return c.slice(1);
    });
    const negativeMatch = negativeContexts.find(function (c) {
        return url.lastIndexOf(c, 0) === 0;
    });
    // If any context negates this url, it must not be proxied.
    if (negativeMatch) {
        return false;
    }
    const positiveMatch = positiveContexts.find(function (c) {
        return url.lastIndexOf(c, 0) === 0;
    });
    // If there is any positive match, lets proxy this url.
    return positiveMatch != null;
};

utils.getTargetUrl = function (options) {
    let protocol = options.ws ? "ws" : "http";
    if (options.https) {
        protocol += "s";
    }

    let target = `${protocol}://${options.host}`;
    const standardPort =
        (options.port === 80 && !options.https) ||
        (options.port === 443 && options.https);

    if (!standardPort) {
        target += `:${options.port}`;
    }
    return target;
};

function onUpgrade(req, socket, head) {
    let proxied = false;

    proxies.forEach(function (proxy) {
        if (
            !proxied &&
            req &&
            proxy.config.ws &&
            utils.matchContext(proxy.config.context, req.url)
        ) {
            if (proxy.config.rules.length) {
                proxy.config.rules.forEach(rewrite(req));
            }
            proxy.server.ws(req, socket, head);

            proxied = true;

            const source = req.url;
            const target = utils.getTargetUrl(proxy.config) + req.url;
            grunt.log.verbose.writeln(
                `[WS] Proxied request: ${source} -> ${target}\n${JSON.stringify(
                    req.headers,
                    true,
                    2
                )}`
            );
        }
    });
}

//Listen for the update event,onces. grunt-contrib-connect doesnt expose the server object, so bind after the first req
function enableWebsocket(server) {
    if (server && !server.proxyWs) {
        server.proxyWs = true;
        grunt.log.verbose.writeln("[WS] Catching upgrade event...");
        server.on("upgrade", onUpgrade);
    }
}

function removeHiddenHeaders(proxy) {
    let hiddenHeaders = proxy.config.hideHeaders;

    if (hiddenHeaders && hiddenHeaders.length > 0) {
        hiddenHeaders = hiddenHeaders.map(function (header) {
            return header.toLowerCase();
        });

        proxy.server.on("proxyRes", function (proxyRes) {
            const headers = proxyRes.headers;
            hiddenHeaders.forEach(function (header) {
                if (header in headers) {
                    delete headers[header];
                }
            });
        });
    }
}

utils.proxyRequest = function (req, res, next) {
    let proxied = false;

    enableWebsocket(req.connection.server);

    proxies.forEach(function (proxy) {
        if (
            !proxied &&
            req &&
            utils.matchContext(proxy.config.context, req.url)
        ) {
            if (proxy.config.rules.length) {
                proxy.config.rules.forEach(rewrite(req));
            }
            // Add headers present in the config object
            if (proxy.config.headers != null) {
                Object.entries(proxy.config.headers).forEach(function ([
                    key,
                    value,
                ]) {
                    req.headers[key] = value;
                });
            }

            proxy.server.proxyRequest(req, res, proxy.server, function (err) {
                if (proxy.config.errorHandler) {
                    grunt.log.verbose.writeln(
                        "Request failed. Skipping to next midleware."
                    );
                    proxy.config.errorHandler(req, res, next, err);
                }
            });
            removeHiddenHeaders(proxy);

            // proxying twice would cause the writing to a response header that is already sent. Bad config!
            proxied = true;

            const source = req.originalUrl;
            const target = utils.getTargetUrl(proxy.config) + req.url;
            grunt.log.verbose.writeln(
                `Proxied request: ${source} -> ${target}\n${JSON.stringify(
                    req.headers,
                    true,
                    2
                )}`
            );
        }
    });
    if (!proxied) {
        next();
    }
};
