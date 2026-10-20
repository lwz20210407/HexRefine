# 过渡网格开源代码调研

2026-10-20。已审阅13个去重项目的README、关键源码和授权说明，覆盖GitHub、
GitLab与Gitee；排除HexRefine和IY724/TransitionMesh。**本轮为源码审阅，不是候选
编译运行认证，也不是已经移植了这13个项目。** 镜像、依赖同一模板库的实现不算
独立算法；平衡树和求解器悬挂节点约束不等于标准H8共形过渡。

## 最值得吸收的三条路线

1. [Element-Saving Hexahedral 3-Refinement](https://github.com/CMU-CBML/Element-Saving-Hexahedral-3-Refinement-Templates)：
   MIT，原始树单元的3:1全Hex模板和悬挂接口消除；与全局对偶路线不同。
   [`RemoveHangingNodesMethod4`](https://github.com/CMU-CBML/Element-Saving-Hexahedral-3-Refinement-Templates/blob/main/src/removeHangingNodeMethod4.cpp)
   分开处理中度平衡、27子单元补细、棱选择和模板安装。优先研究有限状态归一化、
   完整面分区、复合模板与补细闭包；不是直接换掉现有K导入/谱系/事务系统。
2. [CinoLib](https://github.com/mlivesu/cinolib)：MIT，2:1平面/凸凹角棱及强弱平衡分类。
   [`hex_transition_schemes.h`](https://github.com/mlivesu/cinolib/blob/master/include/cinolib/hex_transition_schemes.h)
   提供基础及弱平衡scheme，但表里是**原始多面体**，安装后还须对偶化得到Hex。
   可以吸收case分类、方向/镜像契约和多砖测试，不能把表中cell直接当H8连接。
3. [HOHQMesh](https://github.com/trixi-framework/HOHQMesh)：MIT，Quad的2/3-refinement模板、
   旋转与曲线扫掠。实际
   [`SweeperClass.f90`](https://github.com/trixi-framework/HOHQMesh/blob/main/Source/3DSource/SweeperClass.f90)
   包含平行输运frame和截面缩放，能补现有直线挤出的几何边界。先限开放路径、
   无自交与线性H8；沿程Jacobian、碰撞、端面身份与闭环扭转须分别验证。

## 13个项目的实际价值与边界

| 项目 | 实际源码能力 | 不能误称的能力 | 本轮授权记录 |
| --- | --- | --- | --- |
| [CinoLib](https://github.com/mlivesu/cinolib) | 2:1角棱scheme、对偶Hex安装 | 原始scheme不全是H8；全局对偶不保原EID | MIT |
| [Gen-Adapt-Ref](https://github.com/cg3hci/Gen-Adapt-Ref-for-Hexmeshing) | 配对/平衡规划、调用CinoLib安装与对偶 | 默认未开启install_schemes的树输出不能算已共形 | MIT主仓；Gurobi为外部闭源依赖 |
| [Element-Saving 3-Refinement](https://github.com/CMU-CBML/Element-Saving-Hexahedral-3-Refinement-Templates) | 3-refinement树上的原始Hex替换、棱细化与多级补齐 | 不是任意旧畸变Hex原位替换器 | MIT |
| [Octree27](https://github.com/OpenOctree/Octree27) | 27分、模板表、旋转匹配、缺模板时返回待细化棱 | 完整表面流程是否纯Hex未认证；边界源码访问部分受限 | GPL-3.0正文 |
| [HybridOctree_Hex](https://github.com/CMU-CBML/HybridOctree_Hex) | 强平衡、对偶全Hex、剔除外部、投影与SJ控制 | 不自动保旧材料、ID、集合和历史 | BSD-3-Clause |
| [HOHQMesh](https://github.com/trixi-framework/HOHQMesh) | 全Quad截面、2/3模板、曲线/旋转扫掠 | 不是任意三维局部细化器；H8不能冒充高阶曲边 | MIT |
| [LayerMesher](https://gitlab.com/specfem_cheese_2p/pilot_demonstrator/shared_tools/layer_mesher) | 真实2:1/3:1过渡砖、水平角棱、整数装配 | 存在未覆盖邻域与开裂测试，不是通用正确引擎 | 当前README为GPL-3.0-or-later；未见独立LICENSE |
| [Gmsh](https://gitlab.onelab.info/gmsh/gmsh) | 分块、尺寸场、Quad源面挤出Hex、CAD处理 | 一般重组可混合；不是现成局部Hex过渡模板器 | GPL-2.0-or-later及特定例外 |
| [Robust-Hexahedral-Re-Meshing](https://github.com/gaoxifeng/Robust-Hexahedral-Re-Meshing) | Hex结构简化、固定拓扑优化、SJ与Hausdorff接受门槛 | OPT不消除悬挂；SIM和仅移动节点不能混称 | MPL-2.0；依赖另核 |
| [HexOpt](https://github.com/CMU-CBML/HexOpt) | 表面/邻接、SJ梯度与平滑代码 | 根目录/所读源码未见授权，不能当已明确许可代码复制 | 待澄清 |
| [MFEM](https://github.com/mfem/mfem) | NC自适应、ref321、TMOP形状/尺寸/方向优化 | H1连续性不代表粗细面已变成完整共享四边形 | BSD-3-Clause |
| [p4est](https://github.com/cburstedde/p4est) | 树平衡、层级邻接、悬挂face/edge编码 | 不提供替换过渡Hex；2:1 balance不是共形输出 | GPL-2.0-or-later |
| [FEALPy / Gitee](https://gitee.com/deepmodeling/fealpy) | Quad父子关系、标记、加密/增粗；to_pmesh转多边形 | Quad叶子不代表无悬挂；PolygonMesh不是纯Q4/全Hex | GPLv3+另附商业限制文字，需澄清 |

## 必须保留的代码级反例

- CinoLib的
  [安装器](https://github.com/mlivesu/cinolib/blob/master/include/cinolib/hex_transition_install.cpp)
  后续调用对偶构造。任何移植都要先说明多面体到Hex的身份变化。
- LayerMesher的
  [模板库](https://gitlab.com/specfem_cheese_2p/pilot_demonstrator/shared_tools/layer_mesher/-/blob/main/src/templates/template_library.hpp)
  与[共形测试](https://gitlab.com/specfem_cheese_2p/pilot_demonstrator/shared_tools/layer_mesher/-/blob/main/tests/unit/test_template_conformity.cpp)
  是值得比较的真实连接表和多砖测试；未匹配时保留规则单元的行为不能带入主线。
- p4est的
  [`p8est_lnodes.h`](https://github.com/cburstedde/p4est/blob/master/src/p8est_lnodes.h)
  明确通过face_code记录悬挂face/edge，不能把它包装成已消除悬挂节点。
- MFEM的
  [`ref321.cpp`](https://github.com/mfem/mfem/blob/master/miniapps/meshing/ref321.cpp)
  使用NC变换测试H1连续性；
  [`mesh-optimizer.cpp`](https://github.com/mfem/mfem/blob/master/miniapps/meshing/mesh-optimizer.cpp)
  的TMOP则是另一个质量优化任务。
- HOHQMesh的
  [`Templates.f90`](https://github.com/trixi-framework/HOHQMesh/blob/main/Source/QuadTreeGrid/Templates.f90)
  和[节点/Quad装配](https://github.com/trixi-framework/HOHQMesh/blob/main/Source/QuadTreeGrid/QuadTreeTemplateOperations.f90)
  真实区分2/3-refinement，并非仅README标称。

## GitLab、Gitee实际覆盖

GitLab.com API已读取LayerMesher的关键源与测试。旧搜索摘要中的MIT/Hex27与实时README
不同，本报告采用当前正文。Gmsh自托管GitLab访问受限，代码从
[GitHub镜像](https://github.com/live-clones/gmsh)审阅，未认证镜像与当前上游同步。

Gitee实际访问了FEALPy的
[`Quadtree.py`](https://gitee.com/deepmodeling/fealpy/blob/master/fealpy/mesh/Quadtree.py)
和[`COPYRIGHT.txt`](https://gitee.com/deepmodeling/fealpy/blob/master/COPYRIGHT.txt)，
并核实CinoLib镜像。FEALPy与GitHub同一项目只算一次。部分API超时、站内搜索
ERR_CONNECTION_CLOSED，不能用这些访问失败证明不存在其他项目。
本轮**未在Gitee确认新的独立原生全Hex共形过渡引擎**，长尾检索仍有访问盲区。

## 对后续开发的结论

本轮没有确认一套可直接替换主线、对任意已有畸变H8网格都保证局部2:1/3:1、
边界冻结、正Jacobian和身份保留的通用实现。这是检索结论，不是不存在性定理。

后续先建参考模板的面分区/48方向/多砖/两级闭包测试，再落到允许的patch；
补偿增长、作用范围与失败回滚须可报告。质量优化应冻结必要边界和材料接口，
同时检查最小质量、体积与几何偏差，不靠平均SJ或放宽合并容差掩盖坏接口。

完整中文逐项审查与来源台账保存在本轮小型研究证据目录：
`F:/PythonWoking/temp/20261020-hexrefine-rc-and-mesh-research/research/`。
公开项目的许可与依赖仍须在实际移植时逐文件复核，不以研究用途替代许可核查。
