/*
* SRP, script running PHP or forwarding requests.
* Copyright (C) 2019  shanghuo
* 
* This program is free software: you can redistribute it and/or modify
* it under the terms of the GNU General Public License as published by
* the Free Software Foundation, either version 3 of the License, or
* (at your option) any later version.
* 
* This program is distributed in the hope that it will be useful,
* but WITHOUT ANY WARRANTY; without even the implied warranty of
* MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
* GNU General Public License for more details.
* 
* You should have received a copy of the GNU General Public License
* along with this program.  If not, see <https://www.gnu.org/licenses/>.
* 
* SRP由上火(shanghuo)编写，山岚幽阳网站：www.snang.cc
*/

var url = require("url");
var child = require("child_process");
var path = require("path");
var fs = require("fs");
var http = require('http');
var os = require('os');
var version = '0.0.7';

/**
 * 使用示例
 * 启用端口，并通过一个外部文件进行配置
 * 
 * 调用运行时，不需要下面4行
 */
srp({
    port: 80,
    iniFile: "/root/srp/srp.json"
});

/**
 * 调用本地PHP-cgi
 * HTTP请求的request, HTTP请求的response，配置json
 * 
 * 配置说明
 * bind:绑定域名或IP与前部追加路径的键值对，如"127.0.0.1":""
 * cgidir:PHP-cgi可执行文件的路径
 * phpdir:PHP网站的根目录
 * errfile:当请求或目录不存在时的请求路径，通常设置为"404.htm"
 * index:请求是目录时默认访问的文件，通常设置为"index.php"
 * static:一个存放伪静态对照表的数组
 * addPath:当前请求对应的bind的值部分，也就是前部追加路径（仅单独调用时需要）
 * host:当前请求对应的bind的键部分，也就是绑定IP或域名
 * port:当前服务器使用的端口
 * log:用于输出错误日志的文件夹
 * phperrlog:如果值为真，那么将在错误日志中，记录php程序返回回来的警告信息
 * 
 * 伪静态对照表：
 * in:一个正则匹配表达式（传入时应提前转换为正则形式，而非使用字符串形式传入）
 * out:匹配后用于替换的字符串
 */
function runPHP(req, response, ini) {
    try {
        //对伪静态的处理
        var static = ini.addPath + req.url;
        for (var value in ini.static) {
            static = static.replace(ini.static[value].in, ini.static[value].out);
            if (static != ini.addPath + req.url) {
                break;
            }
        }
        var parts = url.parse(static);

        //对路径文件或目录不存在的处理
        var file = path.join(ini.phpdir, parts.pathname);
        if (!fs.existsSync(file)) {
            file = path.join(ini.phpdir, ini.errfile);
        } else if (fs.statSync(file).isDirectory()) {
            file = path.join(file, ini.index);
        }
        if (!fs.existsSync(file)) {
            response.writeHead(404, 'No Found', { 'Content-Type': 'text/html; charset=utf-8' });
            response.end();
            return;
        }

        //针对php的调用
        if (file.substr(file.lastIndexOf(".") + 1) == 'php') {

            //求虚拟路径
            var pathinfo = parts.pathname, pathtranslated = '';
            var i = req.url.indexOf(".php");
            if (i > 0) {
                pathinfo = parts.pathname.substring(i + 4);
                pathtranslated = path.join(ini.phpdir, pathinfo);
            }

            //准备php-cgi环境变量键值对
            var env = {
                CONTENT_LENGTH: req.headers['content-length'] || 0,
                CONTENT_TYPE: req.headers['content-type'] || '',
                DOCUMENT_ROOT: ini.phpdir,
                GATEWAY_INTERFACE: "CGI/1.1",
                PATH_INFO: pathinfo,
                PATH_TRANSLATED: pathtranslated,
                QUERY_STRING: parts.query || '',
                REDIRECT_STATUS: 1,
                REMOTE_ADDR: req.socket.localAddress || '',
                REMOTE_PORT: req.socket.localPort || '',
                REMOTE_USER: '',
                REQUEST_FILENAME: file,
                REQUEST_METHOD: req.method,
                REQUEST_URI: req.url,
                SCRIPT_FILENAME: file,
                SCRIPT_NAME: parts.pathname,
                SCRIPT_URI: static,
                SCRIPT_URL: static,
                SERVER_ADDR: "127.0.0.1",
                SERVER_NAME: ini.host,
                SERVER_PORT: ini.port,
                SERVER_PROTOCOL: 'HTTP/' + (req.httpVersion || '1.0'), //
                SERVER_SIGNATURE: "SRP(NodeJS) server at localhost, SRP version " + version,
                SERVER_SOFTWARE: "SRP",
                URL: static
            };
            var allHttp = '', allRaw = '';
            for (var k in req.headers) {
                allHttp += 'HTTP_' + k.toUpperCase().replace("-", "_") + ': ' + req.headers[k] + "\n";
                allRaw += k + ': ' + req.headers[k] + "\n";
                env['HTTP_' + k.toUpperCase().replace("-", "_")] = req.headers[k];
            }
            env['ALL_HTTP'] = allHttp;
            env['ALL_RAW'] = allRaw;

            //调用php-cgi
            var php = child.spawn(ini.cgidir, [], {
                env: env
            });

            //处理php-cgi返回
            req.pipe(php.stdin); // 直接将请求流传输到PHP进程中
            req.resume();
            var isHaveHead = false;
            php.stdout.on("data", function (data) {
                try {
                    var line_start = 0, len = data.length;
                    for (var i = 0; i < len; i++) {
                        if (isHaveHead) {
                            response.write(data.slice(line_start));
                            break;
                        }
                        else if (data[i] === 0x3a) {// 找:
                            var key = data.toString('ascii', line_start, i);// :之前的部分
                            i++;// 跳过:
                            var value_start = i;
                            while (i < len) {
                                if (data[i] === 0x0d) {
                                    if (key == 'Status') {
                                        response.statusCode = parseInt(data.toString('ascii', value_start, i).trim());
                                    }
                                    else {
                                        response.setHeader(key, data.toString('ascii', value_start, i).trim());
                                    }
                                    i--;// 回退反斜杠r
                                    break;
                                }
                                i++;// 找行尾
                            }
                        }
                        else if (data[i] === 0x0d && data[i + 1] === 0x0a) {
                            i += 2;// 跳过反斜杠rn
                            line_start = i;
                            if (data[i] === 0x0d && data[i + 1] === 0x0a) {
                                isHaveHead = true;
                                line_start += 2;// 跳过反斜杠rn
                            }
                        }
                    }
                } catch (err) {
                    fs.appendFile(ini.log + '/' + ini.host.replace(/[^a-zA-Z0-9]/g, '_') + '-' + getDay() + 'err.log', getTime() + ': ' + err.toString() + "\n", function (err) {
                        if (err) console.log(err);
                    });
                }
            });
            php.stdin.on('error', function (err) {
                fs.appendFile(ini.log + '/' + ini.host.replace(/[^a-zA-Z0-9]/g, '_') + '-' + getDay() + 'err.log', getTime() + ': ' + err.toString() + "\n", function (err) {
                    if (err) console.log(err);
                });
            });
            php.stderr.on("data", function (err) {
                if (ini.phperrlog) {
                    fs.appendFile(ini.log + '/' + ini.host.replace(/[^a-zA-Z0-9]/g, '_') + '-' + getDay() + 'err.log', getTime() + ': ' + err.toString() + "\n", function (err) {
                        if (err) console.log(err);
                    });
                }
            });
            php.on("error", function (err) {
                fs.appendFile(ini.log + '/' + ini.host.replace(/[^a-zA-Z0-9]/g, '_') + '-' + getDay() + 'err.log', getTime() + ': ' + err.toString() + "\n", function (err) {
                    if (err) console.log(err);
                });
            });
            php.on("exit", function () {
                php.stdin.end();
                response.end();
            });
        } else {
            switch (file.substr(file.lastIndexOf(".") + 1)) {
                case 'htm':
                case 'html': response.writeHead(200, { 'Content-type': 'text/html; charset=utf-8' }); break;
                case 'css': response.writeHead(200, { 'Content-type': 'text/css' }); break;
                case 'js': response.writeHead(200, { 'Content-type': 'text/javascript' }); break;
                case 'jpg': response.writeHead(200, { 'Content-type': 'image/jpeg' }); break;
                case 'png': response.writeHead(200, { 'Content-type': 'image/png' }); break;
                case 'txt': response.writeHead(200, { 'Content-type': 'text/plain' }); break;
                case 'mp3': response.writeHead(200, { 'Content-type': 'audio/mpeg' }); break;
                case 'json': response.writeHead(200, { 'Content-type': 'application/json' }); break;
                case 'xml': response.writeHead(200, { 'Content-type': 'text/xml' }); break;
                default: response.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Disposition': 'attachment; filename=' + encodeURI(file.replace(/^.*\//, '')) });
            }
            fs.createReadStream(file).pipe(response);
        }
    } catch (err) {
        fs.appendFile(ini.log + '/' + ini.host.replace(/[^a-zA-Z0-9]/g, '_') + '-' + getDay() + 'err.log', getTime() + ': ' + err.toString() + "\n", function (err) {
            if (err) console.log(err);
        });
    }
}

/**
 * 将请求转发给远端服务器
 * HTTP请求的request, HTTP请求的response，配置json
 * 
 * 配置说明
 * bind:绑定域名或IP与前部追加路径的键值对，如"127.0.0.1":""
 * addPath:当前请求对应的bind的值部分，也就是前部追加路径（仅单独调用时需要）
 * host:当前请求对应的bind的键部分，也就是绑定IP或域名
 * goto:远端服务器的域名或IP地址
 * port:远端服务器使用的端口
 * static:一个存放伪静态对照表的数组
 * log:用于输出错误日志的文件夹
 * 
 * 伪静态对照表：
 * in:一个正则匹配表达式（传入时应提前转换为正则形式，而非使用字符串形式传入）
 * out:匹配后用于替换的字符串
 */
function httpRelay(request, response, ini) {
    try {
        //伪静态处理
        var url = ini.addPath + request.url;
        for (var value in ini.static) {
            url = url.replace(ini.static[value].in, ini.static[value].out);
            if (static != ini.addPath + request.url) {
                break;
            }
        }

        //到第三方时加的srp标志
        var header = request.headers;
        try {
            header.srp = header.host;
        }
        catch (err) { }
        header.host = ini.goto;

        //向第三方请求
        var options = {
            hostname: ini.goto,
            port: ini.port,
            path: url,
            method: request.method,
            headers: header
        };

        var req = http.request(options, function (res) {
            if (res.statusCode >= 300 && res.statusCode < 400) {
                res.setEncoding('utf8');
                var reg = new RegExp("://" + ini.goto, "gi");
                var headers = res.headers;
                try {
                    headers.location = res.headers.location.replace(reg, "://" + ini.host);
                }
                catch (err) { }
                response.writeHead(res.statusCode, headers);
            }
            else {
                response.writeHead(res.statusCode, res.headers);
            }

            res.on('data', function (data) {
                if (res.statusCode >= 300 && res.statusCode < 400) {
                    data = data.replace(reg, "://" + ini.host);
                }
                response.write(data);
            });
            res.on('end', function () {
                response.end();
            });
        });
        req.on('error', function (err) {
        });

        request.on('data', function (data) {
            req.write(data);
        });
        request.on('end', function () {
            req.end();
        });
    } catch (err) {
        fs.appendFile(ini.log + '/' + ini.host.replace(/[^a-zA-Z0-9]/g, '_') + '-' + getDay() + 'err.log', getTime() + ': ' + err.toString() + "\n", function (err) {
            if (err) console.log(err);
        });
    }
}

/**
 * SRP服务器
 * 配置json
 * 
 * 配置说明
 * port:开启HTTP服务使用的端口
 * log:用于存放日志的路径（日志按日期保存，日期后跟有err的为错误日志，未跟有其它内容的为访问日志）
 * 服务名:为一组服务起一个名字，后面为“调用本地PHP-cgi”或“将请求转发给远端服务器”所需要的配置json
 */
function srp(ini) {
    ini.log = ini.log || '.';
    if (ini.iniFile) {
        getINI(ini, function (inis) {
            ini = inis;
        });
    }
    http.createServer(function (req, res) {
        try {
            var thishost = '';
            var isRun = false;
            for (var k in ini) {
                if (isRun) {
                    break;
                }
                if (ini[k].dashboard) {
                    if (ini[k].dashboard + ':' + ini.port == req.headers.host || ini[k].dashboard == req.headers.host) {
                        isRun = true;
                        thishost = k;
                        ini[k].log = ini.log || '.';
                        dashboard(req, res, ini[k], ini);
                        break;
                    }
                }
                if (ini[k].bind) {
                    for (var host in ini[k].bind) {
                        if (host + ':' + ini.port == req.headers.host || host == req.headers.host) {
                            if (ini[k].phpdir) {
                                isRun = true;
                                thishost = k;
                                ini[k].cgidir = ini[k].cgidir || ini.cgidir || 'php-cgi';
                                ini[k].port = ini.port;
                                ini[k].errfile = ini[k].errfile || '404.htm';
                                ini[k].index = ini[k].index || 'index.php';
                                ini[k].addPath = ini[k].bind[host] || '';
                                ini[k].host = host;
                                ini[k].log = ini.log || '.';
                                runPHP(req, res, ini[k]);
                                break;
                            }
                            if (ini[k].goto) {
                                isRun = true;
                                thishost = k;
                                ini[k].port = ini[k].port || ini.port;
                                ini[k].addPath = ini[k].bind[host] || '';
                                ini[k].host = host;
                                ini[k].log = ini.log || '.';
                                httpRelay(req, res, ini[k]);
                                break;
                            }
                        }
                    }
                }
            }
            if (!isRun) {
                res.end('SRP' + version + ': ' + 'error, domain name is not valid.');
            }
            //请求时间，请求类型，请求URL，请求域名，请求UA，请求来路，请求地址，请求端口
            var logs = getTime() + "\t" + req.method + "\t" + req.url + "\t" + req.headers.host + "\t" + req.headers['user-agent'] + "\t" + req.headers['referer'] + "\t" + req.socket.localAddress + "\t" + req.socket.localPort + "\n";
            fs.appendFile(ini.log + '/' + thishost.replace(/[^a-zA-Z0-9]/g, '_') + '_' + getDay() + '.log', logs, function (err) {
                if (err) {
                    fs.appendFile(ini.log + '/' + thishost.replace(/[^a-zA-Z0-9]/g, '_') + '_' + getDay() + 'err.log', getTime() + ': ' + err.toString() + "\n", function (err) {
                        if (err) console.log(err);
                    });
                }
            });
        } catch (err) {
            fs.appendFile(ini.log + '/' + thishost.replace(/[^a-zA-Z0-9]/g, '_') + '_' + getDay() + 'err.log', getTime() + ': ' + err.toString() + "\n", function (err) {
                if (err) console.log(err);
            });
        }
    }).listen(ini.port);
}
/* 获取日期 */
function getDay() {
    var d = new Date();
    return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
}
/* 获取时间 */
function getTime() {
    var d = new Date();
    return d.getHours() + ':' + d.getMinutes() + ':' + d.getSeconds();
}
/* 读配置文件 */
function getINI(ini, callback) {
    var iniFile = ini.iniFile;
    var port = ini.port;
    fs.readFile(ini.iniFile, 'utf-8', function (err, data) {
        try {
            if (!err) {
                ini = JSON.parse(data, function (k, v) {
                    if (k == 'in') {
                        return RegExp(v);
                    }
                    return v;
                });
                ini["iniFile"] = iniFile;
                ini["port"] = port;
                if (ini.reloadTime) {
                    setTimeout(function () {
                        getINI(ini, callback);
                    }, ini.reloadTime);
                }
                callback(ini);
            }
        } catch (err) {
            if (ini.reloadTime) {
                setTimeout(function () {
                    getINI(ini, callback);
                }, ini.reloadTime);
            }
            fs.appendFile(ini.log + '/' + getDay() + 'err.log', getTime() + ': ' + err.toString() + "\n", function (err) {
                if (err) console.log(err);
            });
        }
    });
}
/* 控制面板 */
function dashboard(request, response, ini, info) {
    /* 判断登录（ini为当前控制面板配置，info为完整的配置内容） */
    if (ini.user && ini.pass) {
        var dashboardLogin = ini.user + ':' + ini.pass;
        dashboardLogin = Buffer.alloc(dashboardLogin.length, dashboardLogin);
        if (!request.headers.authorization || request.headers.authorization != 'Basic ' + dashboardLogin.toString('base64')) {
            response.writeHead(401, 'Unauthorized', { 'WWW-Authenticate': 'Basic realm="srp dashboard login"' });
            response.end();
            return;
        }
    }
    try {
        var thisDate = new Date();
        if (request.url == '/' || request.url == '/index.html') {
            /* 控制面板首页 */
            response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            response.write('<html><head><title>srp</title><style>a {color:#0066ff;}</style></head><body>');
            response.write('<nav><a href="/file.html">file manager</a></nav>');
            response.write('<nav><a href="/loglist.html">log list</a></nav>');
            response.write('<div><h2>SRP</h2>');
            response.write('srp version: ' + version + '</div>');
            response.write('web port: ' + info.port + '<br />');
            response.write('ini file: ' + info.iniFile + '<br />');
            response.write('log path: ' + info.log + '<br />');
            if (info.reloadTime) {
                response.write('reload ini time: ' + info.reloadTime + 'ms<br />');
            }
            else {
                response.write('reload ini time: not configured<br />');
            }
            response.write('<hr /><div><h2>system</h2>');
            response.write('time: <span id="time"></span><br />');
            response.write('OS: ' + process.platform + '<br />');
            response.write('cpu: ' + os.arch() + '<br />');
            response.write('memory usage: <span id="memory"></span><br />');
            response.write('<script>function ajaxOS() {xmlhttp = new XMLHttpRequest();xmlhttp.onreadystatechange = function () {if (xmlhttp.readyState == 4 && xmlhttp.status == 200) {var ini = xmlhttp.responseText.split("\\n");document.getElementById("time").innerHTML = ini[0];document.getElementById("memory").innerHTML = ini[1];}};xmlhttp.open("GET", "/os" + Math.random(), true);xmlhttp.send();setTimeout(ajaxOS, 1000);}ajaxOS();</script></div>');

            /* 配置文件管理 */
            for (var k in info) {
                if (info[k].dashboard) {
                    response.write('<hr /><div><h2>' + k + '</h2>');
                    response.write('domain name: ' + info[k].dashboard + '<br />');
                    response.write('username: ' + info[k].user + '<br />');
                    response.write('password: ' + info[k].pass + '<br />');
                    response.write('file manager start path: ' + info[k].readdir + '<br />');
                    response.write('</div>');
                }
                else if (info[k].bind) {
                    response.write('<hr /><div><h2>' + k + '</h2>');
                    response.write('<table style="width:100%;background-color:#66ccff;"><tr><th colspan="2" style="text-align:left;">binding domain names and corresponding additional paths</th></tr><tr><th style="background-color:#cccccc;width:60%;">domains name</th><th style="background-color:#cccccc;width:40%;">path added to request</th></tr>');
                    for (var host in info[k].bind) {
                        response.write('<tr><td style="text-align:center;background-color:#ffffff;">' + host + '</td><td style="background-color:#ffffff;">' + info[k].bind[host] + '</td></tr>');
                    }
                    response.write('</table>');
                    if (info[k].phpdir) {
                        response.write('<table>');
                        response.write('<tr><th style="text-align:left;">php-cgi file path:</th><td>' + (info[k].cgidir || info.cgidir || 'php-cgi') + '</td></tr>');
                        response.write('<tr><th style="text-align:left;">404 file:</th><td>' + (info[k].errfile || '404.htm') + '</td></tr>');
                        response.write('<tr><th style="text-align:left;">index file:</th><td>' + (info[k].index || 'index.php') + '</td></tr>');
                        response.write('</table>');
                    }
                    else if (info[k].goto) {
                        response.write('<table>');
                        response.write('<tr><th style="text-align:left;">goto:</th><td>' + info[k].goto + '</td></tr>');
                        response.write('<tr><th style="text-align:left;">target port:</th><td>' + (info[k].port || info.port) + '</td></tr>');
                        response.write('</table>');
                    }
                    if (info[k].static && info[k].static.length > 0) {
                        response.write('<table style="width:100%;background-color:#66ccff;"><tr><th colspan="2" style="text-align:left;">URL rewrite</th></tr><tr><th style="background-color:#cccccc;width:60%;">regular expressions for matching</th><th style="background-color:#cccccc;width:40%;">string for substitution</th></tr>');
                        for (var key in info[k].static) {
                            response.write('<tr><td style="background-color:#ffffff;">' + info[k].static[key].in.source + '</td><td style="background-color:#ffffff;">' + info[k].static[key].out + '</td></tr>');
                        }
                        response.write('</table>');
                    }
                    response.write('</div>');
                }
            }

            response.write('<hr /><div><h3>srp ini</h3>');
            response.write('<textarea style="width:100%;height:300px;">');
            response.write(JSON.stringify(info, function (k, v) { if (k == 'in') { return v.source; } return v; }, 4));
            response.write('</textarea></div>');
            response.write('<footer>copyright &copy; shanghuo 2018 - ' + thisDate.getFullYear() + '</footer></body></html>');
            response.end();
        }
        else if (request.url.substr(0, 3) == '/os') {
            /* 系统时间与内存使用 */
            response.write(thisDate.getFullYear() + '/' + (thisDate.getMonth() + 1) + '/' + thisDate.getDate() + ',' + thisDate.getHours() + ':' + thisDate.getMinutes() + ':' + thisDate.getSeconds() + "\n");
            response.write((process.memoryUsage().rss / 1024 / 1024).toFixed(5) + 'M (' + ((process.memoryUsage().rss / os.totalmem()) * 100).toFixed(3) + '%)<div style="width:90%;height:15px;background-color:#33ccff;"><div style="width:' + ((process.memoryUsage().rss / os.totalmem()) * 100) + '%;height:15px;background-color:#ff66ff;float:left;"></div><div style="width:' + ((os.freemem() / os.totalmem()) * 100) + '%;height:15px;background-color:#cccccc;float:right;"></div></div> ' + (os.freemem() / 1024 / 1024).toFixed(5) + '/' + (os.totalmem() / 1024 / 1024).toFixed(5) + 'M (' + ((os.freemem() / os.totalmem()) * 100).toFixed(3) + '%)' + "\n");
            response.end();
        }
        else if (request.url.substr(0, 13) == '/loglist.html') {
            /* 日志列表 */
            fs.readdir(info.log, function (err, list) {
                response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
                response.write('<html><head><title>loglist</title><style>a {color:#0066ff;}</style></head><body>');
                response.write('<nav><a href="/">dashboard</a></nav>');
                if (!err) {
                    for (var key in list) {
                        if (list[key].substr(-7) == 'err.log') {
                            response.write('<a href="/errlog/' + list[key] + '" target="_blank" style="display:block;margin:6px;">' + list[key] + '</a>');
                        }
                        else if (list[key].substr(-4) == '.log') {
                            response.write('<a href="/log/' + list[key] + '" target="_blank" style="display:block;margin:6px;">' + list[key] + '</a>');
                        }
                    }
                }
                response.write('<footer>copyright &copy; shanghuo 2018 - ' + thisDate.getFullYear() + '</footer></body></html>');
                response.end();
            });
        }
        else if (request.url.substr(0, 5) == '/log/') {
            /* 访问日志查询 */
            var dir = path.join(info.log, request.url.substr(5, request.url.length - 9).replace(/[^a-zA-Z0-9_\-]/g, '') + '.log');
            response.writeHead(200, { 'Content-Type': 'text/txt; charset=utf-8' });
            var f = fs.createReadStream(dir);
            f.pipe(response);
        }
        else if (request.url.substr(0, 8) == '/errlog/') {
            /* 错误日志查询 */
            var dir = path.join(info.log, request.url.substr(8, request.url.length - 15).replace(/[^a-zA-Z0-9_\-]/g, '') + 'err.log');
            response.writeHead(200, { 'Content-Type': 'text/txt; charset=utf-8' });
            var f = fs.createReadStream(dir);
            f.pipe(response);
        }
        else if (request.url.replace(/\?.*$/, '') == '/file.html') {
            /* 控制面板文件下载页 */
            var dir = request.url.replace(/^\/file.html[\?]?/, '');
            if (dir == '') {
                dir = ini.readdir;
            }
            else {
                dir = decodeURI(dir);
            }
            fs.stat(dir, function (err, stat) {
                try {
                    if (err) {
                        throw err;
                    }
                    if (stat.isFile()) {
                        response.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Disposition': 'attachment; filename=' + encodeURI(dir.replace(/^.*\//, '')) });
                        var f = fs.createReadStream(dir);
                        f.pipe(response);
                    }
                    else if (stat.isDirectory()) {
                        fs.readdir(dir, function (err, path) {
                            if (err) {
                                throw err;
                            }
                            dir = dir.replace(/\/*$/, '');
                            response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
                            response.write('<html><head><title>file manager</title><style>a {color:#0066ff;}</style></head><body>');
                            response.write('<nav><a href="/">dashboard</a></nav>');
                            response.write('<a href="?' + dir.replace(/\/[^\/]*$/, '') + '" style="display:block;margin:6px;">Go Back</a>');
                            for (var value in path) {
                                response.write('<a href="?' + dir + '/' + path[value] + '" style="display:block;margin:6px;">' + value + ' : ' + path[value] + '</a>');
                            }
                            response.write('<footer>copyright &copy; shanghuo 2018 - ' + thisDate.getFullYear() + '</footer></body></html>');
                            response.end();
                        });
                    }
                    else {
                        response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
                        response.write('<html><head><title>file manager</title><style>a {color:#0066ff;}</style></head><body>');
                        response.write('<nav><a href="/">dashboard</a></nav>');
                        response.write('<a href="?' + dir.replace(/\/[^\/]*$/, '') + '" style="display:block;margin:6px;">Go Back</a>');
                        response.write('<div>Unprocessed file types</div>');
                        response.write('<footer>copyright &copy; shanghuo 2018 - ' + thisDate.getFullYear() + '</footer></body></html>');
                        response.end();
                    }
                }
                catch (err) {
                    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
                    response.write('<html><head><title>file manager</title><style>a {color:#0066ff;}</style></head><body>');
                    response.write('<nav><a href="/">dashboard</a></nav>');
                    response.write('<a href="?' + dir.replace(/\/[^\/]*$/, '') + '" style="display:block;margin:6px;">Go Back</a>');
                    response.write('<div>Error in obtaining path</div>');
                    response.write('<footer>copyright &copy; shanghuo 2018 - ' + thisDate.getFullYear() + '</footer></body></html>');
                    response.end();
                }
            });
        }
        else {
            /* 控制面板404错误页 */
            response.writeHead(404, 'No Found', { 'Content-Type': 'text/html; charset=utf-8' });
            response.write('<html><head><title>404</title><style>a {color:#0066ff;}</style></head><body>');
            response.write('<nav><a href="/">dashboard</a></nav>');
            response.write('srp version: ' + version + '<br />');
            response.write('error: 404');
            response.write('<footer>copyright &copy; shanghuo 2018 - ' + thisDate.getFullYear() + '</footer></body></html>');
            response.end();
        }
    } catch (err) {
        fs.appendFile(ini.log + '/' + ini.dashboard.replace(/[^a-zA-Z0-9]/g, '_') + '-' + getDay() + 'err.log', getTime() + ': ' + err.toString() + "\n", function (err) {
            if (err) console.log(err);
        });
    }
}
