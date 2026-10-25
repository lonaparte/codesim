# CodeSim UI streaming 验证报告

测试目标：[5b8499241406b8b7e6543dc9fa8fb47641f0c4ea](https://github.com/lonaparte/codesim/commit/5b8499241406b8b7e6543dc9fa8fb47641f0c4ea)，`perf/ui-streaming` 分支。对照版本：[08853cb9788b01fd36b1c799b2ff0c3c6889404c](https://github.com/lonaparte/codesim/commit/08853cb9788b01fd36b1c799b2ff0c3c6889404c)。原分支未被修改。

## 实际运行环境

- GitHub Actions 标准 `ubuntu-24.04`，Xvfb 图形环境。
- 官方 VS Code **1.143.1**，真实 Extension Development Host，通过 `--extensionDevelopmentPath` 加载 `npm ci`、`npm run build` 生成的扩展。
- Microsoft Python 扩展 **2026.10.0**，Python **3.12.15**，Node.js **24.21.0**，Playwright **1.64.1**。
- 实际 Python 后端通过扩展的 stdio 通道运行；实际 React Webview 执行仿真按钮、拖动、缩放、派生信号及分析操作。
- CI Python 依赖：NumPy 2.5.4、SciPy 1.18.1、SymPy 1.14.0。另有本地回归检查，依赖版本见 [local-result.json](local-result.json)。
- `npm ci`、`npm run build`、`npm run lint` 均通过；本地 `npm run package:vsix` 成功生成最新源码的 VSIX（71 个文件，约 1.95 MB）。本次 GUI 验证使用源码开发宿主。

实际完成首轮功能对照的运行：[40243910142](https://github.com/lonaparte/codesim/actions/runs/40243910142)。最终增加真实运行中关闭/重开面板操作的运行：[40244302123](https://github.com/lonaparte/codesim/actions/runs/40244302123)。最早两轮仅用于修正自动化连接，未完成 GUI 功能检查，不计入以下结论。

## 已验证的改进

模型为 `VSGSMIBSystem` 默认配置，2 秒仿真，23 路信号，每路 20,003 个采样点，共 401 个流式数据块。

| 首轮真实 GUI 对照 | 前一提交 | 最新提交 |
| --- | ---: | ---: |
| 打开 Signals 后保留拖动后的拓扑位置 | 否 | 是 |
| 仿真完成后保留拖动后的拓扑位置 | 否 | 是 |
| 拓扑视图收到的 `simulation.chunk` 数 | 401 | 0 |
| 仿真完成时发往拓扑视图的 JSON 长度 | 13,995,609 | 5,599 |
| 仿真期间观察到的 DOM 变更批次 | 804 | 209 |
| 首个 chunk 到首次波形 DOM 更新 | 5.9 ms | 126.2 ms |
| 仿真点击至完成后 UI 稳定检查 | 24.229 s | 38.013 s |

JSON 长度是 `JSON.stringify(message).length`，不是网络层实际传输字节数。DOM 变更批次是 MutationObserver 回调次数，不等于 React render 次数或 FPS。首帧等待增加与新增约 100 ms 的刷新节流一致。

以上两次运行来自独立标准 runner，属于功能测试中的观察值，不能据此进行严格的整机性能归因。首轮中端到端仿真耗时未缩短；最终复测中旧版为 51.224 s、新版为 22.511 s，说明运行间存在明显波动，不能宣称整个仿真流程已获得稳定加速。

四组默认波形、缩放、重置时间轴、添加派生信号、小信号分析结果显示和后端启动/停止均完成了实际操作检查。首轮原始结果：[before](results-before-run3.json)、[after](results-after-run3.json)。最终复测的 DOM 变更批次为 805 → 141，首个 chunk 到首次波形更新为 22.3 → 120.3 ms；原始结果：[最终 before](results-before-final.json)、[最终 after](results-after-final.json)。两轮均观察到刷新负担减少，但整机耗时波动较大。

## 新增回归：快照后继续流式更新丢失前段可见数据

在真实 Webview 内重放与中途打开面板相同的消息顺序：

1. 接收一个已有 `0–0.10 s` 数据的 `systemSnapshot`。
2. 接收 `sequence = 1` 的后续 chunk，其数据是 `0.10–0.20 s`。
3. 旧版显示 `0–0.20 s`；新版显示 `0.10–0.20 s`。

原因在 [SignalsApp.tsx 第 69 行](https://github.com/lonaparte/codesim/blob/5b8499241406b8b7e6543dc9fa8fb47641f0c4ea/frontend/webview/src/SignalsApp.tsx#L69)：接收快照时清空了 `SimulationSignalBuffer`，但未将 `next.signals` 填回缓冲区。随后非零序号 chunk 只进入空缓冲区，下一次 flush 就以该 chunk 的后缀数据替换当前完整信号。

最终又用真实按钮操作验证：仿真收到至少 10 个 chunk 后关闭 Signals 编辑器，再重新打开。新版显示的时间范围从 `0.10–0.11 s` 开始，随后一直增长为 `0.10–0.47 s`，前面的 `0–0.10 s` 暂时消失；仿真结束时恢复成 `0–2 s`。这说明是运行中的可见波形历史丢失，并非最终保存结果永久缺失。旧版对应的真实重开操作始终从 `0 s` 开始显示（例如 `0–0.06 s` 到 `0–0.21 s`），最终同样恢复完整 `0–2 s`。详见 [新版最终结果](results-after-final.json) 与 [旧版最终结果](results-before-final.json)。最终 CI 中 before 作业成功、after 作业因该新增回归失败；这不代表 before 的所有优化目标都已满足。

建议在接收快照时同步初始化缓冲区，并保持 dirty 状态与当前快照一致。真正新一轮仿真的 `simulation.started` / 第 0 块仍应清空旧数据。此报告没有修改被测产品代码。

## 既有问题与数据核对

- 两版的流式相角与最终快照存在约 **360°** 的差异。单独执行真实 Python 后端也复现：`bus-1-theta-vsg-terminal` 最大差异 360.00000000000006°，从索引 5650 起出现。后端在每个数据块内分别使用 `np.unwrap`，最终全长计算的相位展开分支可能不同；相关 Python 文件在这次提交中没有变化。
- 时间轴及采样点数一致。另外两路无功功率只有约 `2.22e-16` 的浮点差异。因此逐字 JSON 相等检查失败，不代表本次提交丢失了正常从头开始仿真的采样点。详见 [backend-compare-result.json](backend-compare-result.json) 和 [backend_compare.py](backend_compare.py)。
- 本地 Python 全套测试：20 passed、5 failed、13 subtests passed。前一提交的 core 测试复现同样的 5 项失败，均是 `TwoBusSystem` 测试类没有实现抽象方法 `eventHandler`，属于既有测试问题。
- 两版 GUI 日志均出现内嵌字体被 CSP 拦截的消息；未将其归因于本次改动。

## 数据累积微基准

同一进程内交替测量 5 次，24 路信号 × 200 块 × 每块 250 点，共每路 50,000 点；输入一致，累积输出逐值相等。

| 数据累积耗时中位数 | 前一提交 | 最新提交 |
| --- | ---: | ---: |
| Node.js 微基准 | 3576.20 ms | 43.90 ms |

该环节约快 81.5 倍，仅说明消除重复数组复制的收益，不能外推为 VS Code 界面或整个仿真的加速倍数。检查还覆盖数组身份、输入不被修改、重置、增量极值、尖峰保留、可视范围索引和拓扑边身份。脚本：[numeric.cjs](numeric.cjs)，原始数据：[numeric-result.json](numeric-result.json)。

复跑微基准：先在两个提交的工作目录内安装依赖，再执行 `BEFORE_ROOT=/path/to/before AFTER_ROOT=/path/to/after node --expose-gc qa/numeric.cjs`。

## 费用与写入范围

仅使用公开仓库的标准 `ubuntu-24.04` runner；没有使用 larger runner、Actions cache、artifact 上传、付费 Action 或外部部署服务。证据保存在运行日志及 summary 中。GitHub 官方说明公开仓库的标准 runner 免费，日志与 job summary 不计入 artifact 存储：[计费规则](https://docs.github.com/en/billing/concepts/product-billing/github-actions)。

测试文件位于独立 `codex/verify-ui-streaming-5b84992` 分支，没有改动 `perf/ui-streaming` 或 `main`，没有创建 PR、Issue 或评论。
