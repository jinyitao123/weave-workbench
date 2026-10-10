# Weave与总仓测试更新

记录类型：测试发布说明。日期：2026-10-10。版本：`v0.1.0-rc.7`。总仓来源`e9b916b91a20f189d042a9acb5b3718eeadef40f`，服务器镜像发布来源`631886b8a7fae09a5390dd4b22333989034c15d0`，Weave来源`301c82dc7d2cbe13ef814a115d1b445ded2010a9`。当前部署与限制见[环境说明](../environments/开发联调环境.md)，安装路径见[安装与初始化](../engineering/安装与初始化.md)。本记录与[首轮组合发行](003-三端组合测试预发布.md)分别保留各自观察。

## 交付与更新

[总仓发布](https://github.com/jinyitao123/weave-workbench/releases/tag/v0.1.0-rc.7)提供九个桌面安装文件、服务端Compose配置包、Weave独立Compose包及三个元数据文件，共14附件。桌面覆盖macOS arm64、Windows x64和Linux x64，未签名，Mac未公证；发布为prerelease，不设Latest或自动更新feed。[Weave独立发布](https://github.com/jinyitao123/weave-next/releases/tag/v0.1.0-rc.7)提供同一独立包、独立组合清单、双镜像锁与校验表，共4附件，标签指向准确Weave来源。

成员页覆盖负责人及全部成员，明确实际生效的职责、工作方法、参与和交接条件、模型、能力与执行限制；内置引擎就绪提示与节点要求一致。流程画布增加空间、自适应尺寸、缩放及窄屏查看。工作区飞书应用凭据加密保存并按角色、修订和审计边界维护，团队接入可选择工作流与通知类别。桌面纳入团队配置集中到Weave管理端的已合改动。

Forge源码`288130155728702b5110abcba343893b6783f885`、ObjectUI`df41f84eba3984eb4bbd25d0ccf8c17e40bd1c95`及PG16仍按各自锁记录；本轮重建镜像摘要以附件为准。发布页或代码更新不是现役部署证明。

## 验证与来源

Weave[来源CI38010688417](https://github.com/jinyitao123/weave-next/actions/runs/38010688417)通过。服务器[构建38011571750](https://github.com/jinyitao123/weave-workbench/actions/runs/38011571750)全部成功：完整镜像构建、Forge空库原生启动／同数据库重启、Weave精确来源health／ready、Loom及无执行CLI证明、私有发布均核定；本轮未启用宿主传送。

桌面[原生QA38012204624](https://github.com/jinyitao123/weave-workbench/actions/runs/38012204624)的质量、依赖、Windows迁移、隔离界面及三平台出包／验包全部成功，来源`90367526bb233468d2fbbd72cea866cf9f7adb24`的完整desktop树与发行提交相同。服务器镜像来自单独明确的提交，组件锁与Weave／Forge完整Git树逐项相同；新增匹配／拒绝边界验证通过，组合清单区分镜像与安装器来源。

[总仓发行38013570120](https://github.com/jinyitao123/weave-workbench/actions/runs/38013570120)完成官方归档摘要、来源、私有包读回与附件核对后公开。[独立包38013691336](https://github.com/jinyitao123/weave-workbench/actions/runs/38013691336)实际隔离Compose冷启动、管理页、原生运维身份、同数据库容器重启／同Key验证全部通过，随后追加总仓；Weave仓库沿同字节包单独发布。两个公开页面均已按API核对附件名、大小、SHA256及标签，元数据、独立包和服务端包实际下载核同，包内摘要、代码源和无凭据核定。未读取或修改客户部署。

服务端包`weave-workbench-server-0.1.0-rc.7-linux-x64.tar.gz`，114529字节，SHA256`22d5d1bbbbc5e04d4b95c98b433ca871957febba4dfe33c9b7d16b033c2ee48f`。独立包`weave-standalone-0.1.0-rc.7-linux-x64.tar.gz`，25938字节，SHA256`5e598a593ba809ec6860b38963f5d7461332f5b639e3f75156bcb2bc2ccf5349`；两仓逐字节一致。总仓组合清单23863字节、SHA256`f4b003f5e86ea409af332fce0ade90bf58cb81829467dcb9bdfc8eae923e0379`。下载以各仓`SHA256SUMS.txt`为准；Weave独立镜像继续保持私有，需GHCR Read授权，包不包含离线镜像、部署凭据或执行CLI。

## 未验范围

真实飞书应用、实际消息投递与页面真实呈现、模型／团队业务执行、长期并发和生产准入仍须各自验证；测试或构建不能替代员工业务验收。暂停的合同商务会签及后续签署、订单、项目未继续。原失败与以前部署观察保留原义；本次仅发布新版本，不移动旧标签或改写旧发布记录。
