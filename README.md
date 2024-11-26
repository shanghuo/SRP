> 这是一个过时的仓库,未来大概率不会更新

# SRP
SRP是一个提供node运行PHP的解决方式，同时提供了日志记录、node区分域名处理等操作，或者你可以直接把他看作是一个依靠node运行的服务器解释辅助引擎

## 它到底是啥？
1. 你可以把SRP看作是“Script Run PHP”，但它又不仅仅是脚本运行PHP，它还实现了日志记录等功能
2. 它是由shanghuo开发的，您可以在网站： www.snang.cc ，去查找关于它的一些最初设计
3. 它建议搭配sep框架使用。另外根据sep框架的基础设计，理论上此srp版本与express框架兼容，具体请测试后使用

## srp的作用
- 对于有公网IP但无法绑定域名的服务器，提供域名区分。
- 方便了node与PHP的共存。通过不依靠其它服务器解析引擎，如iis和nginx那些，提供对PHP的调用
- 对访问日志进行记录，并且你可以随时随地在控制台查看服务器的资源占用情况

## srp开发进度与缺陷
srp目前还处于基础的开发阶段。小版本更新理论上不改变整体功能，但不保证大版本更新的向前兼容性。

srp的功能还在不断的完善。虽然对于运行PHP来说，它有个众所周知的性能上的一些缺陷。但对于非特大型网站来说，若希望node与php共存，这问题也不算太大。

当前内容在某些node版本中是存在缺陷的，所以代码仅供参考

## 使用示例
这是srp0.1.0与sep0.0.1搭配使用的使用示例，由于sep框架可能暂未开源（将在稍后开源），理论上你可以使用更笨重的express框架代换它。这里示例中，特别把理论上可被express代换的位置，使用了express作为变量名进行标识。
```
const express = require('./lib/sep');
const srp = require('./lib/srp');
const tc = require('./sep/tc');
var site = srp.Site();
var app = express();
var user = express();
app.use('/tc', tc);
app.use('/user', user);
app.use('/12', function (req, res, next) {
    console.log(1)
    next();
})
user.use(function (req, res, next) {
    //console.log('/user',req.url)
    next();
})
user.use(express.static(__dirname + '/web/user/'))
user.use(function (req, res) {
    res.end('404')
});
app.use(function (req, res, next) {
    //console.log('/',req.url)
    next();
})
app.use(express.static(__dirname + '/web/main/'))
//app.use(express.srp(__dirname + '/web/main/'))
app.use(srp(__dirname + '/web/old/', './php7.1.33/php-cgi.exe'))
app.use(express.static(__dirname + '/web/old/'))
site.add('127.0.0.1', app);
//site.def(function(req,res){
//    res.end('SRP0.1.0: error, domain name is not valid.');
//})
site.listen(80);
//user.listen(8081)
//app.debug();
```
## 完整的通过srp搭建php网站的流程
srp可以当作一个库引入你的项目。也可以直接使用它搭建网站。下面是完整的仅通过srp搭建php网站的流程。

### 1. 下载node
打开[nodejs.org](nodejs.org)下载node并安装  
![docs/img/dlNode.png](docs/img/dlNode.png)

### 2. 下载srp和sep
将本库中srp文件和sep下载到你的电脑

### 3. 下载php
下载你需要的任意PHP版本  
![docs/img/dlPHP.png](docs/img/dlPHP.png)  
如果你需要配置php.ini那么请按照正常步骤配置php.ini。  
请切记需要下载php-cgi，这个程序文件是我们调用时必须的。

### 4. 编写简单的引导代码
TODO: 这部分内容稍后更新

### 5. 试用
在网站文件夹中添加文件index.php
```
<?php echo phpinfo(); ?>
```
  
通过命令行运行
```
node main.js
```
  
在你80端口未被占用的情况下，访问`127.0.0.1`，你会看到已经输出了你下载的php的信息。这说明srp已经配置成功了。  
另外，此srp通过sep框架可支持https协议。

## 与node-php等的效率区别
经网友测试（2019年2月14日），本srp在对php-cgi调用方面，比通过npm安装的node-php效率高3.5倍左右。
