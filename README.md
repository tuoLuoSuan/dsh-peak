# dsh-peak-badge

点一下就知道现在 DeepSeek 是按**高峰价**还是**空闲价**计费。

<img src="https://raw.githubusercontent.com/tuoLuoSuan/dsh-peak/main/docs/composer.png" width="1000" alt="输入框工具行最左边的胶囊">

组件是一个小胶囊（chip），挂在输入框工具行的最左边（`conversation.input.left`）。
胶囊左边一个小圆点，颜色跟着状态走：高峰是琥珀色，空闲是中性色。
点开是一张小卡片，写着当前状态、计费方式、下次切换的时间和倒计时，以及此刻**为什么**是这个状态。

两个状态、浅色和深色主题各来一张。这些图都是 `demo/` 里渲染出来的，跟仓库里的代码同源，
不是另画的（见[截图是怎么来的](#截图是怎么来的)）：

| 空闲（默认） | 高峰 | 深色主题 |
|---|---|---|
| <img src="https://raw.githubusercontent.com/tuoLuoSuan/dsh-peak/main/docs/chip.png" width="300" alt="空闲"> | <img src="https://raw.githubusercontent.com/tuoLuoSuan/dsh-peak/main/docs/chip-peak.png" width="300" alt="高峰"> | <img src="https://raw.githubusercontent.com/tuoLuoSuan/dsh-peak/main/docs/chip-dark.png" width="300" alt="深色"> |

点开的卡片，三个变体：中文空闲、中文高峰、英文空闲。中文空闲那张是**故意挑的最长的一种**：
国庆节里离下个高峰还有 4 天，`下次切换` 这一行是整张卡片能印出的最宽的值。

| 中文 · 空闲 | 中文 · 高峰 | English · off-peak |
|---|---|---|
| <img src="https://raw.githubusercontent.com/tuoLuoSuan/dsh-peak/main/docs/card-off.png" width="312" alt="卡片：中文空闲"> | <img src="https://raw.githubusercontent.com/tuoLuoSuan/dsh-peak/main/docs/card-peak.png" width="312" alt="卡片：中文高峰"> | <img src="https://raw.githubusercontent.com/tuoLuoSuan/dsh-peak/main/docs/card-en.png" width="312" alt="卡片：英文"> |

底部那一行 `系统通知` 有四种状态，每种都把话写在勾选框旁边。左边是权限被拒（**还能再点一次**），
右边是这台机器根本没有通知接口（**唯一会变灰的那种**）：

| 权限被拒 | 没有通知接口 |
|---|---|
| <img src="https://raw.githubusercontent.com/tuoLuoSuan/dsh-peak/main/docs/card-denied.png" width="312" alt="卡片：权限被拒绝"> | <img src="https://raw.githubusercontent.com/tuoLuoSuan/dsh-peak/main/docs/card-unsupported.png" width="312" alt="卡片：没有通知接口"> |

还差几分钟要切换时，右下角会主动弹一条，不用你去点开卡片：

| 要进高峰了 | 要进空闲了 | 深色主题 |
|---|---|---|
| <img src="https://raw.githubusercontent.com/tuoLuoSuan/dsh-peak/main/docs/alert-peak.png" width="312" alt="提醒：即将进入高峰"> | <img src="https://raw.githubusercontent.com/tuoLuoSuan/dsh-peak/main/docs/alert-off.png" width="312" alt="提醒：即将进入空闲"> | <img src="https://raw.githubusercontent.com/tuoLuoSuan/dsh-peak/main/docs/alert-peak-dark.png" width="312" alt="提醒：深色"> |

## 切换前提醒

这是在给「你正在写一个长提示词」这种情况准备的。

费率是在**请求发出去的那一刻**定下来的，不是完成的时候。所以「还有两分钟就要翻倍了」
是一句现在还有用的话，而「刚刚翻倍了」已经晚了。卡片里的倒计时只有点开才看得见。

- 提前量在卡片里选：关闭 / 1 / 2 / 5 / 10 / 15 / 30 分钟，**默认 2 分钟**。
- 每个切换点**只说一次**。判定的键是**边界本身**（北京日期 + 天偏移 + 钟点），
  不是「我什么时候注意到的」——时钟 30 秒跳一次，两分钟的提前量会被看到四次，
  键不稳就会连播四次，而且数字一次比一次小。
- 两个方向都说：要进高峰了（要发就趁现在）和要进空闲了（不急就等一下）。
- 说过的边界不再重说，**换会话、切页面、重新挂载都不会再说一遍**。时钟绑在插件上而不是
  胶囊上，因为胶囊只在会话页存在，而「你正在看别的地方、准备起一个长任务」恰恰是最需要
  知道的时候。
- 可选**系统通知**。勾上时浏览器会问一次权限，四种结局都会写在勾选框旁边：还没试过、
  被拒了（还能再点一次，改完浏览器设置就能开）、或者这个环境根本没有这个 API（唯一会
  变灰的情形）。**勾选状态每次读取都会和浏览器对账**——权限被撤掉之后不会再显示一个
  勾着却发不出通知的框。
- 提醒本身**不改变任何计费行为，也不拦任何请求**。

## 计费规则

来自 [DeepSeek 官方定价页](https://api-docs.deepseek.com/zh-cn/quick_start/pricing)：

> 北京时间周一至周五（不含中国法定节假日）9:00 - 12:00、14:00 - 18:00 为高峰时段；
> 其余时段，包括周末及中国法定节假日全天均为空闲时段。

> 空闲时段价格为高峰时段价格的一半。

所以谷时是 5 折。周末整天、法定节假日整天，无论几点都是谷时。

判定完全在浏览器里算：读本机时钟，换算成北京时间，再查一张硬编码的节假日表。
不发任何网络请求，不依赖 DeepSeek 的接口。价格表什么时候变，那是官方定价页的事，
这个插件只回答「现在落在哪一档」。

## 装

需要 DSH（DeepSeek Harness）。开发和验证是在 `@deepseek-ai/dsh@0.2.0-rc.2` 上做的。

### 从仓库装

跟着 `main` 分支走，不经过 npm，推荐。

```
dsh plugin --profile desktop add github:tuoLuoSuan/dsh-peak
```

profile 名就是侧栏「工作区」对应的那个（桌面端默认 `desktop`）。

### 装 npm 上的版本

```
dsh plugin --profile desktop add dsh-peak@0.2.0
```

**别装成 `dsh-peak-badge`。** 那个裸名字是**别人的包**（`mj5809`，停在 0.1.1，不是本项目）——
本项目是 `dsh-peak`，一字之差装到的是另一个插件。

这个包以前叫 `@tuoluosuan/dsh-peak-badge`；0.2.0 起改名成 `dsh-peak`，旧名字停在 0.1.x。
两者代码同源，改名只是为了让市场里那张卡片显示成一行。

npm 上那份跟这个仓库同源，但不会自动跟着 `main` 走，想拿到新版本得等下一次发布。

版本号是故意写上的。pnpm 11 内置一个 24 小时的发版冷却期（`minimumReleaseAge`），这段时间里
**裸包名不解析到 `latest`**，而是解析到冷却期之外最新的那一版——命令照样成功、照样打印一行 `+`，
只是装到的是上一版。0.1.2 刚发布时跑裸包名，装到的是 0.1.1。

### 这一份装得上吗

```
node docs/probe-npm-install.mjs
```

在一个一次性的 profile 里真的装一遍，装的就是 `package.json` 里钉住的那一版，然后回答这个仓库
自己回答不了的三个问题：宿主有没有把它当插件收下、装进去的是不是你要发的那一版、以及那个包名在
三个地方是不是同一个。

最后一个值得多说一句。宿主是从 `cordis.patch.yml` 里学到这个包叫什么名字的，而那份补丁里的名字
和 `package.json` 里的名字**没有任何东西在比对**：写错一个字母，安装照样成功、注册照样成功、
插件永远不加载。所以这里把两份名字读出来对一遍，顺带确认 `dsh.client.inject` 声明的依赖不是空的。

找不到 `dsh` 会以退出码 2 结束并列出它找过的路径，`PEAK_BADGE_DSH_CLI` 可以指定。

### 在对话里让 DSH 自己装

```
plugin_manager action: install_bundle target: github:tuoLuoSuan/dsh-peak
```

### 本地开发

克隆下来直接指目录：

```
plugin_manager action: install_bundle target: D:\path\to\dsh-peak-badge
```

`target` 接受包名（可带版本）、git 地址、tarball 或本地绝对路径。

装完刷新页面。替换已装版本需要重启才能加载新代码（热加载只覆盖新装的 bundle）。

### 装不上或者想卸载

```
plugin_manager action: list_bundles
plugin_manager action: remove_bundle target: dsh-peak
```

`list_plugins` 里应该能看到这个包且 `fiberPhase: active`。

## 自己验一遍（推荐）

面板上的数字是算出来的，所以这里有能跑的证明：

```
node verify-policy.mjs
```

在仓库根目录直接 `node verify-policy.mjs`，在归档区那种外面套一层目录的地方则是
`node dsh-peak-badge/verify-policy.mjs`，都一样。

它把 `client.js` 里 `#region policy` 到 `#endregion` 之间那段（纯函数，无 React、无 DOM、
无服务）抠出来执行，跑八十多条断言：节假日表 33 天逐个对名字、四种边界分钟（9:00 / 12:00 /
14:00 / 18:00）的开闭、周末与节假日全天、调休日、秒数对齐、跨年拒绝回答、时区无关性，
以及两个曾经真的算错过的场景。一个是工作日 12:30（必须说「今天 14:00」，曾经说「明天 09:00」），
另一个是周五 20:00（必须说「3 天后 09:00」，曾经说「明天 09:00」，而那是周六）。

它接着把 `#region text` 那段也抠出来（`new Function` 包一层，塞一个假的 `locale` 服务进去），
验两种语言的数字格式、日期偏移词、每一句理由整句、以及中英来回切换之后中文能不能回来。
最后一类是真实存在过的 bug：恢复中文的路径曾经是一份手抄的字面量表，抄漏了一个键。

最后一段是**两段合起来**验的：同一个 `new Function` 里先放 policy 再放 text，
然后真正按卡片的方式跑一遍 `reasonSentence(peakState(...))`。分开验时两边都是手喂的假数据，
所以 policy 把 `{ name: ... }` 改名、或者模板里把 `{name}` 打错，都能全绿通过，
而卡片上会直接印出 `{name}`（`fill` 是故意把缺失的占位符留在原地的）。
这一段就是为了堵这个缝，并且额外盯住 `dateText` / `weekday` / `schedule` 三个
别的断言都没碰过的字段。

再往后是**切换前提醒**的两段。先是 `alertPlan`——纯函数，验什么时候该说话、什么时候该闭嘴、
以及「同一条边界」的键到底稳不稳（时钟 30 秒一跳、提前量 2 分钟，键不稳就会连说四次）。

然后是本文件里唯一一段**带状态**的验证：把 `#region policy` + `#region text` + `#region alert`
+ `#region view` 四段一起抠出来，配一个**能手动走的时钟**、几十行的假 DOM、一个把 `React.memo`
当作恒等函数的 `React`，真的把时钟跑起来，也真的把那张卡片的设置行画出来读。
验的是纯函数验不到的东西——一条边界只播一次、再跳四拍还是同一条通知、下一个边界会替换掉
上一条、昨天的键不会让今天的边界闭嘴、提前量设成 0 就彻底安静、`document.body` 还没建好时
**不消耗**那一次发言机会、自动消失走的是 `timer.timeout` 而不是被客户端的半场禁掉的裸
`setTimeout`、偏好存得下也读得回、`{"leadMinutes":3}` 这种 select 画不出来的值被拒绝、
系统通知要「用户勾了」**且**「浏览器给了权限」两个条件同时成立才发。

通知那一行现在是**画出来读**的，因为「点了没反应」是肉眼才发现的：四种结局各自的文案都在
（没试过 / 被拒 / 环境没有这个 API / 默认未授权），被拒之后**仍可点**、只有 API 缺失才变灰，
而按下之后走的是真的 `onChange` 加真的 promise 链，两种答案形态各走一遍
（`requestPermission` 现代版 resolve 权限**字符串**，老版给回调传**布尔值**），并断言一次按下
只结算一次。这一段抓到的第二个真 bug 就在这里：原来写的是 `granted === true`，于是现代引擎
返回的 `'granted'` 被判成没给权限，框自己弹回去、文案还说「还没试过」——正是用户报的那句
「点了没反应」。改成 `answer === true || answer === 'granted'` 之后才通。
这一段还曾经抓到过一个真的时序依赖：`showToast` 靠一个由 `apply` 赋值的模块级变量拿定时器，而赋值在
`startAlertClock` 后面——第一次播报（同步发生的）就没有自动消失。现在
`startAlertClock` 自己认领那个定时器，顺序不再能被写反。

时区这件事值得单说：DSH 跑在用户本机时区上，而答案永远是北京时间的。这条不靠推理，
上面有一组专门的断言，并且整个文件可以在别的时区下重跑（`TZ` 环境变量 Node 会读）：

```
TZ=UTC                  node verify-policy.mjs
TZ=America/New_York     node verify-policy.mjs
TZ=Asia/Shanghai        node verify-policy.mjs
TZ=Pacific/Kiritimati   node verify-policy.mjs
```

四个时区都是 200 条全过。把 `peakState` 里的 `getUTC*` 换成 `get*`（一个很自然的
「简化」），这套断言立刻挂。验证过，不是推测。

退出码按本工作区的约定分三种：`0` 全过，`1` 有断言挂了（**代码错了**），
`2` 根本没跑起来（与代码无关）。加了 `--dump` 会把抠出来的那段代码印出来。
最后还压了一条底线：跑过的条数少于预期（现在是 200）也一样按 1 退出，
否则「某个小节整段没跑」会打印成「0 passed, 0 failed」然后安安静静地返回 0。

> 关于这套断言的可信度：写它的时候，我**手算的期望值错了六次，机器每次都对**。
> 所以别相信「我看了一眼觉得对」，改动之后跑一遍。

## 一个刻意的选择：调休日按周末算

调休上班日（2026 年是 1/4、2/14、2/28、5/9、9/20、10/10）虽然是「上班日」，
但它们落在周六或周日。官方规则逐字写的是「包括**周末**……均为空闲时段」，
所以这里**按字面执行**：调休日一律算谷时。

卡片会在这种日子明说这件事，而不是默默按某个解释算：

> 调休上班日，但官方规则按周几算，周末一律空闲（周六），全天按空闲时段计价。

如果你认为调休日该按上班日算，改一处即可：`client.js` 里让 `peakState` 的
`isMakeup` 判定同时要求「不是周末」，工作日分支就会接住它。只改文案不算改，
文案和判定必须一起动，否则卡片会理直气壮地说反话。

`verify-policy.mjs` 里有一条专门盯这个的走查：周五 20:00 必须跨过调休的周六 5/9
走到周一 09:00；把调休算成工作日，它会答「周六早上」，该断言立刻挂。

## 跨年：表外的年份说「不知道」，但周末还是知道

法定节假日表只有国务院当年那份通知是权威的，所以它是硬编码的
（2026 年那 33 天来自[国务院办公厅关于 2026 年部分节假日安排的通知](https://www.gov.cn/zhengce/zhengceku/202511/content_7047091.htm)，国办发明电〔2025〕7 号）：

- `client.js:56-74` — `HOLIDAY_TABLE`（2026 年七行节假日 + 调休上班日）
- `client.js:77-80` — `HOLIDAY_COVERAGE` / `LATEST_COVERED_YEAR`

覆盖范围是**从表本身推出来的**（`Object.values(HOLIDAY_TABLE).map((e) => e.year)`），
不是另写一个 `[2026]` 常量：年份同时喂给 `Date.UTC` 和「表到哪年」的检查，
两边不可能对不上。加一年就是往 `HOLIDAY_TABLE` 里再放一条。

到了表外的工作日，徽章**不会猜**，而是显示「未知」并说明原因：

> 节日表只到 2026 年，2027 年的法定节假日无从判断。

这是故意的。一个在元旦当天还自信地说「峰时」的徽章，比一个承认自己不知道的徽章更糟，
它会在你最需要它准的时候骗你。明年出了新通知，把上面三处换掉即可。

**但表外不等于全都不知道**，这个区别值得单独说，因为它一开始被写错了。
官方原文是「其余时段，**包括周末**及中国法定节假日全天均为空闲时段」——周末那一句
不需要查任何一年的通知。而且这个插件本来就让周末规则压过调休（见上面「调休日按周末算」），
所以表外的**周六周日依然是确定的谷时**，只是那句「下次切换」不再给：

> 周六；官方规则里周末不查节假日表 · 全天按空闲时段计价。
>
> 下次切换：表外的年份，无法判断下一个高峰

只有**工作日**才退回「未知」。也就是说 `2027-01-02`（周六）答「谷时」，
`2027-01-04`（周一）答「不知道」——因为那天到底是不是元旦假期，2026 年 10 月还没人知道。

一个诚实但没必要的「不知道」也是错的：它把「我查不到」和「我查得到，是谷时」说成了同一句话。
判断标准是**这条结论到底依赖不依赖那张表**，不是「表里有没有这一年」。

（顺带一提：还有别的同类插件在这种情况下会退化成「工作日按周一至周五推算」并照常给出
下次切换时间。那更有用，但也更可能说错。这里选了诚实那一边。）

## 文件

| 文件 | 作用 |
|---|---|
| `package.json` | 包定义：`dsh.bundle.patch`、`dsh.client`（`platform: web`、`immediately`）、`icon`、`exports` |
| `cordis.patch.yml` | 往 profile 里插一行插件 |
| `index.js` | 宿主半边，空的 |
| `client.js` | 全部功能：策略 + 渲染 |
| `verify-policy.mjs` | 上面那个能跑的证明 |
| `docs/probe-npm-install.mjs` | 在一个一次性 profile 里真的装一遍（`node docs/probe-npm-install.mjs`） |
| `demo/` | 截图用的页面与渲染脚本（`node demo/shoot.mjs`），产物在 `docs/` |
| `locale/{en,zh}.json` | 插件列表里显示的名字和说明（`meta.title` / `meta.description`） |
| `icon.svg` | 插件列表里的图标，`currentColor`，跟随主题 |

宿主半边（`index.js`）是空的：策略只依赖北京时间与节假日表，没有要抓的东西、
也没有要排的活，没必要为了对称塞点东西进去。整个功能都在 `client.js`。

`meta.title` / `meta.description` 由平台从 `locale/<语言>.json` 读，读不到就退回
`package.json` 的 `name` / `description`，所以没有这两个文件时，插件列表里显示的是
`dsh-peak` 这种模块名。`exports` 里必须放开 `./locale/*.json`，
否则平台的解析器拿不到它（`exports` 是白名单）。

`client.js` 用 `#region` 分成五段：`policy`（纯函数，可单独抠出来执行）、
`styles`、`text`（语言表与两个格式化函数）、`alert`（切换前提醒的时钟与那条通知）、
`view`（React）。
其中 `#region policy` / `#region text` / `#region alert` 的边界是 `verify-policy.mjs`
依赖的约定，改结构时别把它们删了。

判定与文案是分开的：`peakState` 只返回**键和数字**（`reason: 'makeup'`、
`next: { at, inDays, leftMinutes }`），句子在 `#region text` 里拼。
这条边界就是 `verify-policy.mjs` 能单独执行这两段的原因：一旦 policy 里出现
`text.xxx`，验证脚本会立刻抛 `ReferenceError`（真发生过一次）。

`#region alert` 是唯一一段**有状态**的代码（`announcedKey`、当前那条通知的节点、
它自己的定时器），所以它也是唯一一段需要**配一个假 DOM 真的跑起来**才能验的。
它刻意不碰 React：那条通知要在胶囊没挂载的时候也能弹出来，所以它是纯 DOM 建的。

## 不能改坏的七件事

1. **时间只能从 `ctx.get('timer')` 拿。** 反复执行的东西走
   `ctx.get('timer').interval(cb, ms)`，一次性延时走 `timeout`；两种都返回 disposer。
   服务查询和 `interval()` 都要包在 `try` 里，上下文一旦销毁，`ctx.effect`
   会抛 `INACTIVE_EFFECT`，而卸载和销毁本来就是会撞车的。
   别改用全局 `setTimeout`：动态客户端包里它是会抛错的陷阱（`client.js:9-11` 记的就是
   这条），而且即使在这里能用，它也不跟页面生命周期绑定，卸载后会继续跑。同理，语言切换
   靠的是 `locale.subscribe`（`client.js:612-634`），不是重新加载。

   **在哪里创建，取决于这个定时器是给谁用的。** 胶囊自己的那两个（刷新状态、刷新倒计时）
   建在 `React.useEffect` 里，disposer 当清理函数交回去。**切换前提醒的时钟不是**：
   它建在 `apply` 的 `ctx.effect` 里，命绑在插件上。因为胶囊只挂在
   `conversation.input.left` 槽位上，也就是只有会话页存在时才在——而「用户正在看设置页、
   准备起一个长任务」恰恰是最需要那条提醒的时候。把它挪进组件的 effect 会让提醒在最需要
   它的场景里恰好消失，而且换个会话就会把「这条边界已经说过了」忘掉一次。

   顺带一条时序约束：那条通知的自动消失（`timer.timeout(closeToast, TOAST_MS)`）用的定时器
   是 `startAlertClock` **自己认领**的，不是调用方先赋好再调它。因为 `startAlertClock`
   会在返回前**同步**播报一次，调用方若在它之后才赋值，第一次播报就没有自动消失——
   一条永远不走的通知。验证脚本就是靠这个抓到的。

2. **周几要按「那一刻」算，不能按「那一天」算。** 北京时间的周五 18:00 之后就是谷时，
   一直谷到周一早上；如果周几取自当天日期，周五晚上就会被算成工作日峰时。
   代码读的是那个瞬间本身（`peakState` 里的 `shifted`）。

3. **`offPeakReach` 里必须有两个时钟。** 今天（`inDays === 0`）按**此刻的分钟**判定，
   之后每一天按**零点**判定。两者缺一不可：都用此刻，18:00 之后每一天都「已经过了
   今天的窗口」，整条走查会返回「找不到」；都用零点，12:30 的午休会答成
   「09:00 还没到」。这个坑两边都踩过。

4. **注入的 `<style>` 必须带 `data-plugin`。** `dsh-client-modules` 的
   `removeOwnedStyles`（`lib/client.js:194-197`）只清 `style[data-plugin]`，
   而且是在工厂失败和版本切换时清。少了这个属性，卸载后样式会留在页面上，
   下一个版本的规则就会和旧规则打架。

5. **收卡片靠 `document` 上的 `pointerdown`，别只靠 blur。** 第一版只用 `onBlur`
   判断「焦点离开了」，但点在**不可聚焦**的地方（正文、输入框背景）根本不会移动焦点，
   也就没有 blur 事件，卡片只能靠再点一次胶囊才关上（用户抓到的就是这个）。
   现在的做法是在 `document` 上捕获阶段听 `pointerdown`（`client.js:697-705`），
   判断依据是 `ref: rootRef` 那个根节点（`client.js:708`）。
   捕获阶段是故意的：卡片内部若有处理器 `stopPropagation`，冒泡阶段就收不到。
   在这里卸载卡片是安全的，靠的是 `root.contains(event.target)` 那道包含判断：
   卡片现在**是有可点的东西的**（提前量那个 `<select>`、通知那个勾选框），它们都长在根节点
   里面，所以按它们不会关卡片；按卡片外面的正文或输入框背景才关。这条判断现在是必需的——
   在 `<select>` 上按下 `pointerdown` 会展开原生菜单，此时把卡片拆掉，看起来就和这个控件坏了
   一样。`onBlur` 保留下来只管键盘：焦点移到真正的兄弟节点时收起来，
   `relatedTarget === null`（焦点离开文档）那条路已经由指针监听器先一步处理了。

6. **胶囊和卡片的底色必须是不透明色，而且必须读静态色板。** 壁纸插件
   （`dsh-wallpaper-engine`）一装，它就在 `<body>` 上挂 `data-we-glass-page`，
   然后把**所有能画出实色面的别名 token** 都折进玻璃配方：输入框的
   `--dsw-specific-input-major`、卡片原来用的 `--dsw-alias-bg-overlay`，
   还有 `--dsw-alias-bg-layer-1/2/3`、几个 button-fill。两个症状都是用户抓到的：
   胶囊原来是 `background: transparent`，壁纸直接透上来，12px 的字落在壁纸花纹上；
   卡片读了被改写过的 `--dsw-alias-bg-overlay`，于是**点开的面板是透明的**。
   **靠 `var(token, #fallback)` 的回退救不回来**——改写的值是 `color-mix(...)`，
   是合法值，变量依然存在，回退永远不触发。
   现在胶囊用 `--dsw-static-neutral-bluish-00` / `-850`（正是那个面色 token 在没装
   插件时的两个取值，所以实心胶囊在两种主题下都和输入框同色），卡片用
   `--dsw-static-neutral-bluish-150` / `-875`（`--dsw-alias-bg-overlay` 不透明时
   背后的那对值）。`verify-policy.mjs` 会把四个底色都抠出来，确认它们是实色
   token、浅深不同色、不是 `transparent`，并禁止卡片回退到 `--dsw-alias-bg-overlay`；
   再算一遍文字对底色的对比度（胶囊 5.8:1 / 9.3:1，卡片 16:1 / 15:1）。

   实心之后又加了一点**壁纸自己的颜色**（`--we-surface-tint-light` / `-dark`，插件
   会先把它钳进每个主题的可读亮度带），这样实心面不至于像贴在画上的贴纸。两条
   线卡着它：混合里**没有任何 `transparent`**，所以结果不可能变成窗口；权重是
   `calc(25% * (1 - var(--we-wallpaper-opacity, 0)))`（卡片 30%），跟着壁纸的
   不透明度走，壁纸淡出时权重归零、退回纯静态色。权重是量出来的：12% 那次整段
   位移只有 4 个 RGB 单位（`#b98f5e` 混进 `bluish-150` 得到 `#e9ecf1`，肉眼看不见）。
   另外**这个 `calc()` 的写法是有讲究的**：`calc((100% - var(--o, 0)) * 12%)` 能过
   `CSS.supports()`，却会在计算值阶段被 Chromium **静默丢掉**，结果退回上面那条静态
   声明、看起来「加过了」其实一点没加。必须写成 `calc(12% * (1 - var(--o, 0)))`，
   验证器现在只认这一种写法。

7. **样式表那个模板字面量里不能出现反引号。** 里面的内容是 CSS，不是源码，所以写在
   里面的注释得小心：反引号会**提前结束字面量**，整个 `client.js` 就成了语法错误，
   插件加载不起来，卡片是空的——0.1.4 就是这么发出去的，而当时 `verify-policy.mjs`
   打印的是「176 passed, 0 failed」，因为它把 `client.js` 当文本读，从来没编译过它。
   所以卡片里那句解释（设置行是卡片里唯一可点的东西，因此卡片保留 dialog 角色）
   写在 `const CSS` 的**上面**。验证器现在把整个文件编译一遍，并且要求写进去的块注释
   **在里面配对闭合**（多出来的 `*/` 会关掉外层 JavaScript 打开的注释，后面的东西
   全被当成代码编译），顺便数一遍规则条数。

## 两个踩过的渲染坑

### 颜色别用 `--dsw-alias-state-idle-primary`

它在浅色主题下是 `--dsw-static-neutral-300`，也就是 `#d4d4d4`。那是画边框用的灰，
1.2:1，在白底输入行里几乎看不见（第一版就是这样，被用户抓到了）。谷时/未知改用
`--dsw-alias-label-secondary`（中性蓝灰 #61666b，约 5.0:1），它在浅色和深色主题下都跟着走。

### 圆点要显式写 `corner-shape: round`

主题装了一条全局规则 `*, :before, :after { corner-shape: var(--dsw-corner-shape) }`，
而那个变量是 `superellipse(1.5)`（`dsh-client-ui-theme/lib/client.js:1145`）。在支持的
浏览器里，一个 6px 的 `border-radius: 50%` 方块不会被这个规则收成圆：超椭圆在 6px 上
边是平的，它渲染成一个圆角方块。放大 10 倍渲染两种写法对比过：只有显式 `round` 才是正圆。
不支持的引擎会忽略这条声明，所以可以无条件留着。主题自己的文档里也写了这条要求
（`dsh-client-ui-theme/README.zh.md:76`：正圆形状「须在所属组件样式表中把
`corner-shape: round` 与半径声明配对」）。

## 卡片往上弹，不会被裁掉

卡片的定位是 `position: absolute; bottom: calc(100% + 8px)`，必然要向上溢出输入框那一行，
所以专门查过一遍输入框祖先链会不会 `overflow: hidden` 把它切掉，**不会**：
`.card` / `.root` / `.dock` / `.composerSeat` 都不声明 overflow，带 `overflow-y: auto` 的
`.scroll` 是卡片里那段**文字**的滚动区，胶囊所在的那一行是它的兄弟节点而不是子节点。
平台自己也有两个同样往上弹、同样不用 portal 的先例：
`dsh-client-ui-input-trigger` 的 `.Z9Jnlq_menu`（`lib/client.js:976`）和
`dsh-client-ui-commands` 的 `.EhuiKa_card`（`lib/client.js:1166`），
都是 `bottom: calc(100% + 4px)` 的绝对定位。所以这里不需要 portal。

样式只用 `--dsw-alias-*` 主题令牌，不引任何 Harness Client 包，
不往 `document.body` 上挂东西。

## 无障碍

胶囊是一个真的 `<button>`：`aria-expanded` / `aria-controls` / `aria-haspopup="dialog"`，
`title` 里带完整状态；卡片是 `role="dialog"`；圆点本身是 `aria-hidden`（颜色只是重复文字）。
键盘：Tab 能聚焦，Escape 关卡片，卡片里那两个设置（提前量、系统通知）都是原生控件，
Tab 能走到、方向键能改，并且它们的 `<label>` 都带 `for`。

那条提醒是 `role="status"` 而**不是** `role="alert"`：值得瞟一眼，不值得打断正在打的字。
它的关闭按钮有 `aria-label`。系统通知只在用户勾了、且浏览器给了权限时才发——这两条
任何一条不成立，卡片会写明是哪一种，而不是摆一个按了没反应的勾选框。

因为它在输入行里、不在 `aria-hidden` 子树里，
所以不需要额外的屏幕阅读器播报区（有些同类插件需要，是因为它们把徽章放进了品牌行）。

## 和别的同类插件比

做之前不知道已经有人做过，做完才发现有五六个，核心判定完全一致
（包括调休怎么算、节假日表逐条相同）。功能上的差别大致是：

- 这里点开是**卡片**（有的同类是悬停 tooltip 或只切换显示档位）
- 这里会写出**节假日的名字**（春节 / 国庆节），不只是「法定节假日」
- 这里**跨年会明确说不知道**，而不是猜
- 这里有一条**切换前提醒**，而且提前量可调

提醒这件事上要说清楚：[dsh-cost-meter](https://www.npmjs.com/package/dsh-cost-meter)
做得比这里多得多——它有峰谷切换的全页弹窗、可调 1–30 分钟的提前量、倒计时轨、
26 周日格热力图，还会**去抓官方定价页解析价格表与生效时间**。这个插件只有那条通知和
卡片里的倒计时。两者不冲突：装上它之后，这个胶囊的价值主要在「一眼看到档位」而不是
「提醒你切换」，因为提醒那块确实是人家的主场。

参考过的项目：[AK-blank/dsh-plugin-offpeak-badge](https://github.com/AK-blank/dsh-plugin-offpeak-badge)、
[dsh-peak-badge](https://www.npmjs.com/package/dsh-peak-badge)、
[future007s/dsh-peak-indicator](https://github.com/future007s/dsh-peak-indicator)、
[blueziii/dsh-peakvalley](https://github.com/blueziii/dsh-peakvalley)。

## 验的时候别只验一半

分两段验很自然，两段本来就能各自单独执行，但它有个盲点：**缝上的错两边都看不见**。
policy 交出 `reasonParams`，text 拿模板去填；分开验时两边喂的都是手写的假数据，
所以把 `{ name: holiday }` 改名、或者在 `REASON_ZH` 里把 `{name}` 打错，
一百多条断言照样全绿，而卡片上印的是字面量 `{name}`。

同一个盲点还有第三种形态，而且更难看见：**两段都对，接线错了**。
`alertPlan` 能算出「该说话了」，`showToast` 能把通知画出来，各自都验得过——
但把「算出来的那一个」交给「画出来的那一个」的那个人写错了，谁都不会红。
所以 `#region alert` 那一段不是分开验的，是**整条跑起来**的：真的把时钟点着、
真的跳几拍、真的去假 DOM 里数那几条通知。它就是这么抓到那个时序 bug 的
（第一次播报没有自动消失，因为定时器是调用方在播报之后才赋的值）。

所以 `verify-policy.mjs` 末尾有一段用**同一个 `new Function`**（先 policy 后 text）
把整条路走一遍：`reasonSentence(peakState(那一刻))`，再顺手扫一遍所有可能出现的理由键，
确认没有任何 `{...}` 残留。往这个文件里加东西时，
「新加一条断言」比「多看一眼」便宜得多，理由见上面那个引用块。

同一个盲点还有第四种形态，也是最难发现的：**整个文件根本编译不过**。

0.1.4 就是这样发出去的。`client.js` 的样式表是一个模板字面量，我在里面写了一句注释，
注释里用了反引号。反引号提前结束了那个字面量，整个文件成了语法错误，插件加载不起来，
卡片是空的。而那个时候 `verify-policy.mjs` 打印的是 **176 passed, 0 failed**，
截图也照样渲染出七张漂漂亮亮的图——因为它把 `client.js` **当文本读**：
policy 是从里面切出来单独编译的，样式表是正则匹配的，这个文件能不能编译，它从来没问过。
真正报错的是浏览器，报在插件的加载上。

修法不是「下次注意」，是让验证器**执行**这个文件。它现在用 `new Function` 把整个
`client.js` 编译一遍——就是浏览器加载时做的第一件事——并且要求顶层那次
`window.__ModuleLoader__.load({...})` 真的被调到、id 就是包名。整个文件编译不过时，
它打印浏览器给的那句原话：`Unexpected identifier 'role'`。

同一个盲点里的最后一点：那个模板字面量里的内容**是 CSS，不是源码**，所以写在里面
的块注释只有也在里面打开才算闭合——一个多出来的 `*/` 会关掉外层 JavaScript 打开的注释，
后面的东西全被当成代码编译。所以验证器查的是**配对**而不是「不许出现」，顺便数了一遍
规则条数（现在 34 条）：一条规则被多余的定界符吞掉时，字面量其余部分完好无损，
别的断言全都会过。

## 截图是怎么来的

这些图都是从仓库里的代码渲染出来的，所以不会和代码说的不一样：

```
node demo/shoot.mjs
```

`demo/index.html` 是一个**真的**页面：拿真 DOM 拼出胶囊和卡片，样式则是从 `client.js` 的
`#region styles` 里**切出来的真 CSS**（连主题令牌都换成了官方主题里解析出来的值）。
`demo/shoot.mjs` 用无头 Edge 打开它，按元素裁剪，写进 `docs/`。

胶囊只有 52 css px 宽，所以它的截图按 6 倍像素渲染（卡片 4 倍，提醒条 3 倍），放进 README 里
再放大也不糊。每张图的倍率写在 `demo/shoot.mjs` 的 `SHOTS` 里。图片在 README 里显示成
300 px（胶囊）和 312 px（卡片与提醒条），这两个数字也是写在 `<img>` 标签上的：Markdown 的
`![]()` 语法带不了 `width`，所以这里用的是 HTML。

卡片截图里那四种通知状态不是四张手改的图，是同一个页面加 `?notify=prompt|denied|unsupported|idle`
拍的——真的权限由浏览器给，`file://` 页面骗不到，所以这个查询参数是唯一能把「权限被拒」
拍下来的办法。demo 页只仿制 CSS，那一段行内文案是照 `renderAlertControls` 抄的，改那边记得改
`demo/index.html` 的 `NOTE` 表。

提醒条是 `position: fixed`，量到的是**视口坐标**，所以它拿的是单独一张页面
（`?view=toast`）、不是在卡片那张上面叠着拍——页面一旦滚动，两者就对不上了。

`src` 写的是 `https://raw.githubusercontent.com/...` 的绝对地址，不是 `docs/chip.png`
这种相对路径。相对路径其实也能显示——npm 会拿 `repository` 字段去 GitHub 上找图
（本机另一个插件就是这么发的，页面上图是好的）。这里仍然用绝对地址，是因为它不依赖
那条规则：不管谁在渲染、按什么规则找图，那个地址都指向同一张图。附带的好处是装完包
在本地翻这份 README 时图也看得见——`docs/` 不在 `files` 里、不进 tarball，相对路径
在这里是找不到文件的。

开头那张三格合成图是例外：它不是三张并排，而是三行竖排。并排时每一格只分到整栏的三分之一，
620 px 的输入框被压到两百来 px，再高的倍率也救不回来。竖排之后每格占满整栏，输入框显示成
620 px 上下，比它本身还大一点。每格的框高还是量出来的：`demo/shoot.mjs` 会读 iframe 里
`.composer` 的实际高度，再把框设成那么高——写死的话，要么切掉一截，要么留一条深色主题画下去的
黑边。为此无头浏览器要加 `--allow-file-access-from-files`，否则 `file://` 的 iframe 里
`contentDocument` 是 null，量不到。

`demo/shoot.mjs` 收工前还会量一次卡片的每一行：哪一行溢出了，或者被迫折成了两行，
它就**报错退出，不写图**。折行在 PNG 上是看不出来的（卡片只是变高一点，什么都不像坏了），
所以这事只能量，不能靠眼睛看。

几个已经踩过的坑，改这个脚本之前值得知道：

- `--screenshot` 不能用来截组件。它截整屏，要手算留白，而且在脚本跑完之前就开火，
  于是会产出一张「空白但看起来像成功了」的图。改成用 DevTools Protocol 的
  `Page.captureScreenshot`，裁剪框从 `getBoundingClientRect()` 拿。
- 切 CSS 要认准 `const CSS = \`` 这个锚点，不能取 `#region styles` 里的第一个反引号：
  那段开头是 `const STYLE_TAG_ID = \`${PACKAGE_ID}/styles\`;`，按第一个反引号切会把半个
  插件塞进 `<style>`，每条规则都失效，页面退化成裸标签。
- 注入的 `<style>` 必须放在 `<meta charset="utf-8">` 之后。放在 `<head>` 之后（也就是
  charset 之前）时，解析器还在预扫描编码声明，插件里的中文注释先到了，整段 CSS 用别的
  编码解出来，`display` 不成立，组件量出来是 0×0，看上去却像渲染成功了。
- 裁剪 `?view=chip` / `?view=card` 时不能把 `.composer` 藏起来，胶囊就在它里面；
  藏了它，胶囊跟着一起没，同样是 0×0 的空白图。只藏输入行里别的元素。
- 别用 `?inlined=1` 这种由调用方传的开关来判断样式有没有内联：调用方忘了传，
  截图照样成功、照样空白。改成检测 DOM 里有没有那个 `<style>`。
  这和 `verify-policy.mjs` 的底线检查是一回事：让失败看起来像成功，是最贵的一种 bug。

## License

MIT
