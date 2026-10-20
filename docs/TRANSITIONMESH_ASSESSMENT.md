# TransitionMesh 源码盘点与吸收记录

日期：2026-10-20。研究对象：[IY724/TransitionMesh](https://github.com/IY724/TransitionMesh)，
固定版本 `cba8cb962e6fedf95be80164e641943f0aa99455`。
本项目基线：HexRefine `6aae2c5`。用户明确本工作用于非商业研究和学习。

## 1. 结论与边界

该版本公开了13个Python模块，包括界面、计数规划、拓扑模板、几何映射和运行管理。
没有发现只有安装包二进制才具备的核心模块，本轮没有使用REA、没有下载或安装大型安装包。
公开源码不等于无使用限制：README标注作者IY及非商业研究用途。研究副本保留原文件和出处；
本次主线实现复用HexRefine原有模板，并未把对方Python源码或安装文件直接打包进仓库。

它主要是**先规划过渡带，再对Abaqus几何分区、播种并生成网格**。
3D模式依赖选定实体已有可用的结构化/扫掠条件；不是面对任意已有Hex网格的通用细化器。
因此它不能直接证明之前任意O-grid奇异线、固定奇数分区或复杂剪切区都能由同一模板解决。

## 2. 十三个模块分别负责什么

以下路径相对于[固定版本的plugin目录](https://github.com/IY724/TransitionMesh/tree/cba8cb962e6fedf95be80164e641943f0aa99455/plugin)。

| 模块 | 关键入口 | 实际职责与借鉴价值 |
| --- | --- | --- |
| `TransitionMesh/transitionMesh_plugin.py` | `AFXForm`、canonical loader | 菜单注册、参数采集、部署文件哈希一致性；不是网格内核 |
| `TransitionMesh/transitionMeshDB.py` | PickHandler、字段联动 | 对象拾取、能力提示、检查结果过期；可借鉴交互契约，不依赖其AFX界面 |
| `TransitionMesh/transition_mesh_gui_kernel.py` | `run_transition_mesh_gui`、`_audit_execution` | 模式路由、预试划分、执行审计、批处理；与算法可分离 |
| `transition_mesh_rules.py` | `capability`、`hybrid_split`、`angular_fit` | 能力表、同层混排、相位检查；限制必须绑定具体模式/模板 |
| `transition_mesh_plan.py` | `plan_counts`、`allocate_widths` | 多级计数、逐层带宽、附近合法值；计数通过不等于几何可生成 |
| `transition_mesh_plugin.py` | `build_transition_patch`、`partition_planar_transition` | 平面4→2/3→1基础模板及局部坐标系、分区和播种 |
| `transition_mesh_plugin_planar2d.py` | annular/quad-four plan及apply | 圆环、四侧矩形、几何检查、实际网格质量审计 |
| `transition_mesh_quad2.py` | `count_chain`、`build_plan`、`build_topology` | 2:1四侧环带的独立拓扑；角部计数及级间规则补环 |
| `transition_mesh_quad2_cae.py` | CAE plan/apply | 将上述拓扑变成几何分区和网格，不是另一套通用Hex模板 |
| `transition_mesh_corner_templates.py` | corner patch、wedge、multistage | 专门角部模板与质量约束；不能用简单拼四条直带代替 |
| `transition_mesh_plugin_cylinder_kernel.py` | radial/axial规划与执行 | 圆柱坐标框架、径向预切分、轴向切片、扫掠和播种 |
| `transition_mesh_runtime.py` | `ModelTransaction`、`publish` | 模型快照/恢复、阶段日志、原子结果文件 |
| `transition_mesh_regions.py` | `build_region_signature`、`resolve_selection` | 拓扑变化后的区域重定位；坐标签名不能替代我们的单元谱系 |

## 3. 五类模式对照

| 原模式 | 原实现特点 | 本轮之前的HexRefine | 本轮状态与未覆盖部分 |
| --- | --- | --- | --- |
| PLANAR | 2:1/3:1、方向、带宽、多级；同层可混排 | 已有Q1/Hex基础模板，但缺独立带状生成入口 | 直带、多级带宽、反转和同层混排均已实现；分组/交错/指定顺序有原生接口和GUI |
| PLANAR_ANNULAR | 周期模板、相位、内细/外细、闭环与扇区检查 | 圆形靶板子集，不能代替任意独立环带 | 原生圆环/扇区、多级、内外细端、起始角已实现；对已有CAE几何缝的重新匹配未实现 |
| PLANAR_QUAD_FOUR | 专门角部、任意平面旋转、级间规则补环 | 已有GUI61矩形生成和局部细化，不等价于该环带计数法 | 原生2:1/3:1环带、角部、显式补环和精确中心填充已实现；3:1多级采用独立补环规则并报告派生外尺寸 |
| ANNULAR_RADIAL | 端面过渡后沿轴向扫掠；多层需要预切分 | 有GUI61实体圆柱壳体子集 | 新增环带直线挤出可生成独立空心Hex带；不是对已有实体自动分区/拼接 |
| AXIAL_SURFACE | 圆柱轴向带、径向切片、相位冲突检查 | 有受限挤出拓扑局部细化，不是该参数化接口 | 独立轴向空心Hex体、多级、径向层、反转、扇区和任意轴框架均已实现；与径向带明确区分 |

**特别区分：**

- “同层混排”是同一条带由不同倍率块并排组成；`ratios:[2,3]` 是先2:1、后3:1两级，不是同层混排。
- 四侧外扩环含角部贡献，整边数量不能简单按2除。源码例12→8→6，而网格间距逐级增大。
- `quad2.count_chain(12,4)` 实测得到12→8→6→6→6，第3、4级插入规则补环；不应误判为倍率失效。
- 2:1直带每个模板周期4个细段接2个粗段，这一整除约束不是“任意奇数Hex网格数学上都无解”。
- 本轮圆环的内半径必须大于零，不是实心圆柱/O-grid中心自动划分。
- 直带的平面旋转不是GUI61厚度方向倾角，圆环的网格层也不是有间隙的多层物理壳体。

## 4. 值得吸收的工程机制

1. **规划与执行分离**：输出每一级计数、带宽、预期接口，明确哪些只是计数检查。
2. **只读Check、真实Pre-mesh、Apply**：预览应验证真实网格，且输入变化后旧结论必须失效。
3. **失败原子性**：Abaqus复制整个模型的做法不直接照搬；本项目继续用不可变输入/事务或新输出目录。
4. **错误带修正建议**：最近合法计数用整除条件精确计算，不做短距离盲搜。
5. **逐模式能力表**：不能把矩形开关套到圆柱，也不能把已通过一个案例写成全组合支持。
6. **接口相位与几何匹配**：检查闭环和原有分区，而非仅坐标近似相等。
7. **角部独立模板**：四条直带单独正确，并不保证环带角部共形。
8. **批量区域签名**：部件、位置、面积和长度均有用，但要保留ID谱系并在歧义时拒绝。

本项目已有会话undo/redo、回放、共形审计和失败保护；不是这些机制全部缺失。
尚需统一的是跨生成器的“检查/试生成/应用”接口及能力说明，而非重新实现一套历史管理。

## 5. 审阅发现与未确认风险

### 已实际运行确认

- `plan_counts(24.9,1,2)` 把24.9截断为24；布尔层数True也被当作1。原生新接口明确拒绝这种输入。
- `suggest_counts(100,8,3)` 返回空列表，而`nearby_counts`能给出6561。限制搜索窗口不能代表不存在合法值。
- 四侧2:1多级计数包含角部与补环贡献，必须使用其专门规则，不能套用直带乘积公式。

### 代码审阅风险，不冒充已在CAE中复现

- `_audit_execution`的某些3D查询失败只给警告；2D路径则把缺少审计字段当硬失败。应统一验收口径。
- `run_transition_mesh_batch`先取模型中的第一个Part，再定位区域；多Part场景特别是几何重合时应专测。
- 区域签名保留最多20个面参考点且重定位主要依赖pointOn/尺寸；不等于完整拓扑签名。
- README、能力表和代码对四侧3:1多级支持的描述不完全一致，必须逐例确认。
- 某些坐标查询/拾取路径含`eval`，新接口不应将任意输入当代码执行。

## 6. Abaqus 2020 实测，而非版本号推断

本机默认Abaqus实际版本为2020，内置Python 2.7.15；本轮成功签出CAE许可并实际划分。

原代码的首轮障碍：未声明UTF-8编码；Python 2没有`math.gcd`和`math.isfinite`。
研究副本只增加编码声明，测试进程补两个标量标准库兼容函数；原下载源码与已安装插件目录不变。
圆柱内核还存在Python 2不允许删除闭包捕获变量`sk`的语法，**尚未完整适配所有模块或GUI**。

| 实际CAE案例 | 节点 | CPS4R单元 | 与原生网格几何连接对照 |
| --- | ---: | ---: | --- |
| 4→2单级平面带 | 11 | 6 | 一致 |
| 3→1单级平面带 | 8 | 4 | 一致 |
| 8→4→2平面带 | 26 | 18 | 一致 |
| 9→3→1平面带 | 24 | 16 | 一致 |
| 12→6→2混合级序列 | 36 | 26 | 一致 |

采用唯一坐标匹配容差1e-8比较单元节点集合；不是原编号或文件字节一致。
这认证上述平面划分路径，不认证Abaqus2020下完整插件、所有圆柱模式或GUI安装。
没有保存大型CAE模型，没有改动用户正在使用的模型。

### 6.1 持续开发后的新增实测

又实际运行了2个同层混排案例、2个2:1四侧案例、2个3:1四侧案例。研究进程另补了
Python 2日志兼容，涉及`os.makedirs(exist_ok=...)`和日志`open(encoding=...)`；原文件仍未修改。
新增对照使用1e-7的唯一坐标匹配；前述首批5例使用1e-8。

| 新增实际CAE案例 | 节点 | 单元 | 对照结论 |
| --- | ---: | ---: | --- |
| 同层分组混排14→6 | 32 | 20 | 按拾取细边的局部方向归一化后连接一致 |
| 同层指定顺序混排14→6 | 32 | 20 | 同上；源细边方向为-X，归一化包含X镜像 |
| 2:1四侧12×8、两级 | 180 | 148 | 节点几何及单元连接一致 |
| 2:1四侧8×8、三级 | 264 | 236 | 节点几何及单元连接一致 |
| 3:1四侧9×9、单级 | 80 | 52 | 节点几何及单元连接一致 |
| 3:1四侧9×9、两级 | 148 | 124 | 源分支为QUAD+FREE，报告预估369；与原生显式补环构造不同 |

最后一例仍通过源程序的无三角形/Jacobian等检查，但不能把PASS解释为其模板数量及级间计数都已兑现。
原生实现保留每级完整接口，必要时补规则单元圈，因此派生外尺寸45×45，区别于源案例33×33。
源/原生的外形范围与拓扑差异均保留记录，不要求或声称这一例几何连接重放一致。

## 7. 已吸收进主线的独立实现

- `src/transition-bands.ts`：计数规划、直带、圆环/扇区、细端反转、最多8级接口，以及直线+Z挤出。
- 2:1基础带从本库既有Owen `pattern2`的面投影并镜像配对构成；3:1复用本库既有Q1四单元模板。
- 不引用研究副本、不调用Abaqus/MATLAB/TrueGrid，不依赖第三方Python模块运行。
- `scripts/generate-transition-band.mjs`：版本化JSON请求，验证成功才写新目录；输出K、INP、集合、参数和报告。
- `test/transition-bands*.test.mjs`：方向、计数、闭环、级间共形、质量、非法输入和文件回读。
- 8个原生案例另由NumPy独立检查，并在LSPP实际打开，保存16张ISO/局部图。
- 全量TypeScript回归801/801通过（其中新增过渡带/CLI测试16项）；不是全部原插件能力都已移植的证明。
- 持续补齐：`transition-rect-rings.ts`、`transition-axial-tube.ts`及同层混排；统一请求/CLI/worker/离线接口与五模式GUI。
- GUI具备计数检查、试生成、应用及参数变化后的试结果失效；原七类GUI也完成了兼容性浏览器检查。
- 最终全量回归837/837通过，包含轴向接口等高、同层混排、四侧补环和计数建议测试。12个GUI生成结果另经NumPy独立审计，8个模型追加了16张LSPP视图。
- 6份小型请求示例随仓库提交，可直接用CLI或GUI重放，不依赖本机临时研究目录。

细节与调用方式见 [TRANSITION_BANDS.md](TRANSITION_BANDS.md)。计数器允许1至8级；
固定网格回归覆盖至3级，8级目前有计数检查，不宣称8级工程规模组合已全面验证。

## 8. 能力边界与后续工程

原先列出的同层混排、四侧补环、轴向圆柱和对应GUI/试生成已补齐。
仍需区分独立参数化生成与已有模型处理：

1. 对已有CAE工程保留分区/播种、自动拾取和重新定位，依赖CAD上下文，不等同于独立网格生成。
2. 将新过渡块自动拼入任意已有Hex网格，仍受本项目原有选区、补偿与拒绝契约约束。
3. 任意空间平面源面和曲线路径扫掠属于更大范围；轴向圆柱已支持任意空间轴，不代表所有曲面扫掠。
4. 源插件全部GUI/圆柱模块的Abaqus2020兼容尚未认证；主线新功能运行无需Abaqus。
5. 持续细化级数、几何长宽比与工程规模的组合验证继续按具体应用开展。

## 9. 证据目录与存储

`F:/PythonWoking/temp/20261020-transitionmesh-assessment/`：

- `repository-tree.json`、`upstream-sha.txt`、`reference/`：固定版本参考源码；仅供本地研究。
- `reference-probe.json`：纯Python计数、基础模板、四侧补环实测。
- `abaqus2020/probe-result.json`：原始兼容失败；`abaqus2020_compat/`与`abaqus2020_matrix/`：成功的实际CAE结果。
- `compat2020-manifest.json`：最小研究副本修改与原始文件哈希。
- `abaqus-native-comparison.json`：五例几何连接对照；`native/`：原生K/INP、参数、审计与视图。
- `independent-native-audit.json`：独立质量/边界检查；`TRANSITIONMESH_REVIEW.html`：图文验收入口。
- `followup_abaqus/`、`followup-comparison.json`：新增6例实际CAE结果及差异。
- `followup_gui/`、`followup-independent-audit.json`：五模式GUI、试生成/应用、下载K/INP与LSPP视图。
- `TRANSITIONMESH_COMPLETE_REVIEW.html`：持续补齐后的完整验收入口。

只保留小规模可复核证据，不下载9.5MB Word附件或无必要的安装包；不把研究副本误提交为本项目源码。
