#!/usr/bin/env python3
"""Rebuild local research indexes from saved UI evidence; never accesses the site."""
import hashlib
import json
import re
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DOCS = ROOT / "docs"
BASE = DOCS / "references/risemap-capture"
steps = [json.loads(line) for line in (BASE / "steps.jsonl").read_text().splitlines()]
assert len({row["id"] for row in steps}) == len(steps), "Duplicate evidence step"
for row in steps:
    for key in ("screenshot", "state"):
        assert (BASE / row[key]).is_file(), row

deep_path = BASE / "deep-records.jsonl"
deep_records = [json.loads(line) for line in deep_path.read_text().splitlines() if line.strip()] if deep_path.exists() else []
assert len({row["recordId"] for row in deep_records}) == len(deep_records), "Duplicate deep record"
step_by_id = {row["id"]: row for row in steps}
for row in deep_records:
    assert row["evidenceStep"] in step_by_id, row

manifest = []
for path in sorted(BASE.rglob("*")):
    if path.suffix in (".png", ".txt"):
        manifest.append({"file": path.relative_to(BASE).as_posix(), "bytes": path.stat().st_size,
                         "sha256": hashlib.sha256(path.read_bytes()).hexdigest()})
(BASE / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n")

index = ["# RISEMAP 逐步截图总索引", "", "每行对应一个实际采集步骤。截图、页面文字与操作说明一起保留，功能分析见 [分析入口](../../risemap-capture-analysis.md)。", "",
         "| 步骤 | 操作说明 | 截图 | 页面状态 |", "| --- | --- | --- | --- |"]
for row in steps:
    index.append(f"| {row['id']} | {row['label']} | [截图]({row['screenshot']}) | [文字]({row['state']}) |")
(BASE / "README.md").write_text("\n".join(index) + "\n")

# Extract only menu entries present in actual saved accessibility snapshots.
navigation = [("工作台", "077-home-dashboard"), ("供应链", "078-navigation-supply-chain"),
              ("销售", "079-navigation-sales"), ("生产", "080-navigation-production"),
              ("项目", "081-navigation-projects"), ("行政", "082-navigation-admin"),
              ("财务", "083-navigation-finance"), ("报表", "084-navigation-reports"),
              ("系统", "085-navigation-system")]
inventory = []
for category, evidence in navigation:
    path = BASE / f"{evidence}.txt"
    if not path.exists():
        continue
    lines = path.read_text().split("免费试用中")[0].splitlines()
    group = category
    for i, line in enumerate(lines):
        match = re.match(r"^(\s*)\d+ button (.+)$", line)
        if not match or match[2] == "收起侧边栏":
            continue
        indent = len(match[1])
        children = []
        for following in lines[i + 1:]:
            if len(following) - len(following.lstrip()) <= indent:
                break
            children.append(following)
        image_count = sum(bool(re.match(r"^\s*\d+ image", child)) for child in children)
        if image_count > 1:
            group = match[2]
            continue
        name = match[2]
        inventory.append({"id": f"RM-{len(inventory) + 1:03}", "category": category,
                          "group": group, "name": name,
                          "kind": "guide" if "上手指南" in name else "entry",
                          "navigationEvidence": evidence,
                          "status": "menu_observed", "url": None})

progress_path = BASE / "page-captures.jsonl"
page_captures = [json.loads(line) for line in progress_path.read_text().splitlines()] if progress_path.exists() else []
for item in inventory:
    captures = [row for row in page_captures if row["featureId"] == item["id"]]
    if captures:
        item["status"] = "initial_page_captured"
        item["url"] = captures[-1]["url"]
        item["captures"] = captures
(DOCS / "risemap-feature-inventory.json").write_text(json.dumps(inventory, ensure_ascii=False, indent=2) + "\n")
counts = Counter(item["category"] for item in inventory)
features = ["# RISEMAP 全量功能清单", "", "来自已登录试用空间的九类主导航。每项仍可包含多个页签、详情、编辑和异常状态；菜单数量不等于完整页面数量或已验证功能数量。厂商页面显示试用期间享全部功能、剩余14天，尚未与厂商完整版清单独立核对。", "",
            "| 分类 | 已发现入口数 |", "| --- | --- |"]
features += [f"| {category} | {count} |" for category, count in counts.items()]
features += ["", f"合计 {len(inventory)} 个入口，包含上手指南。", "", "| 编号 | 分类 | 分组 | 功能入口 | 当前状态 |", "| --- | --- | --- | --- | --- |"]
for item in inventory:
    status = "首屏已采集，流程未验证" if item["status"] == "initial_page_captured" else "仅发现菜单"
    features.append(f"| {item['id']} | {item['category']} | {item['group']} | {item['name']} | {status} |")
(DOCS / "risemap-feature-inventory.md").write_text("\n".join(features) + "\n")

# Generate a conservative first-page control contract from the rendered DOM evidence.
# It captures labels only and deliberately excludes row values and other tenant data.
contracts = []
for item in inventory:
    captures = item.get("captures", [])
    if not captures:
        continue
    capture = captures[-1]
    dom_path = BASE / f"{capture['step']}.dom.txt"
    if not dom_path.exists():
        continue
    dom = dom_path.read_text()
    main = dom.split("- main:", 1)[-1]
    main = main.split('- button "打开 AI 助手"', 1)[0]
    def unique(pattern):
        return list(dict.fromkeys(re.findall(pattern, main)))
    contracts.append({
        "featureId": item["id"], "category": item["category"],
        "group": item["group"], "name": item["name"],
        "url": capture.get("url"), "evidence": capture["step"],
        "headings": unique(r'- heading "([^"]+)"'),
        "buttons": unique(r'- button "([^"]+)"'),
        "textboxes": unique(r'- textbox "([^"]+)"'),
        "columnHeaders": unique(r'- columnheader "([^"]+)"'),
        "links": unique(r'- link "([^"]+)"'),
        "scope": "loaded initial page only; dialogs, forms, tabs and workflows remain separate coverage",
    })
(DOCS / "risemap-page-contracts.json").write_text(json.dumps(contracts, ensure_ascii=False, indent=2) + "\n")
contracts_md = ["# RISEMAP 首屏控件合同", "", "本文件从加载后页面证据提取标题、操作按钮、输入框和表格列名，不包含企业数据值。它只证明首屏呈现，不证明按钮结果、表单规则或业务流程。", "", "| 编号 | 页面 | 标题 | 主要按钮 | 输入框 | 表格列 |", "| --- | --- | --- | --- | --- | --- |"]
for item in contracts:
    fmt = lambda values: "、".join(values) if values else "无"
    contracts_md.append(f"| {item['featureId']} | {item['category']} / {item['name']} | {fmt(item['headings'])} | {fmt(item['buttons'])} | {fmt(item['textboxes'])} | {fmt(item['columnHeaders'])} |")
(DOCS / "risemap-page-contracts.md").write_text("\n".join(contracts_md) + "\n")

# Organize the next-stage review by business vertical. Raw evidence stays immutable in
# one directory; these workbooks provide the domain-first path through that evidence.
category_slugs = {
    "工作台": "workbench", "供应链": "supply-chain", "销售": "sales",
    "生产": "production", "项目": "projects", "行政": "administration",
    "财务": "finance", "报表": "reports", "系统": "system",
}
group_slugs = {
    "工作台": "workbench", "到货检验": "arrival-inspection", "基础资料": "master-data",
    "采购管理": "purchasing", "入库管理": "inbound", "库存管理": "inventory",
    "出库管理": "outbound", "销售业务": "sales-operations", "CRM客户管理": "crm",
    "组装业务管理": "assembly", "图纸管理": "drawings", "委外管理": "subcontracting",
    "项目管理": "project-management", "审批中心": "approval", "行政管理": "office",
    "人力资源": "hr", "考勤假期": "attendance", "流程中心": "workflow",
    "资金管理": "funds", "业务确认": "business-confirmation", "发票管理": "invoices",
    "报表": "business-reports", "财务统计": "financial-reports",
    "系统设置": "system-settings", "业务设置": "business-settings",
}
contract_by_id = {item["featureId"]: item for item in contracts}
feature_by_id = {item["id"]: item for item in inventory}
vertical_root = DOCS / "risemap" / "verticals"
vertical_root.mkdir(parents=True, exist_ok=True)
vertical_index = ["# RISEMAP 垂直功能走查", "", "这里按业务功能域组织深度走查。原始截图保持在统一证据目录，避免移动后破坏编号和校验；每份功能域工作簿链接对应证据。", "", "首屏盘点只完成入口发现。每条垂直主线还要验证新建、状态变化、上下游单据、金额数量、异常续办和角色权限。", ""]
for category in category_slugs:
    category_items = [item for item in inventory if item["category"] == category]
    if not category_items:
        continue
    category_dir = vertical_root / category_slugs[category]
    category_dir.mkdir(parents=True, exist_ok=True)
    vertical_index += [f"## {category}", ""]
    groups = list(dict.fromkeys(item["group"] for item in category_items))
    for group in groups:
        items = [item for item in category_items if item["group"] == group]
        filename = group_slugs[group] + ".md"
        vertical_index.append(f"- [{group}]({category_slugs[category]}/{filename})，{len(items)} 个入口")
        workbook = [f"# {category} / {group}", "", f"当前发现 {len(items)} 个入口。以下顺序是本域纵向走查骨架；只有首屏完成采集，业务闭环仍未验证。", "",
                    "## 纵向完成标准", "",
                    "1. 核对主数据和配置依赖，记录必填、默认值、编号及权限。",
                    "2. 保存新建表单的空态、校验、填写、提交和成功结果。",
                    "3. 跟踪详情页、状态转换、审批、撤回、驳回、作废和恢复。",
                    "4. 核对数量、金额、版本、库存或工时在上下游页面的变化。",
                    "5. 验证搜索、筛选、排序、分页、批量、导入导出、打印和附件。",
                    "6. 用重复提交、非法值、缺少权限、同时编辑和下游失败测试异常分支。",
                    "7. 用相关角色分别操作，形成菜单、记录、字段和动作权限矩阵。",
                    "8. Forge实现后用同一输入逐项对照外观、行为、数据和恢复结果。", "",
                    "## 页面与当前证据", "", "| 编号 | 入口 | URL | 首屏标题 | 主要操作 | 证据 | 深度状态 |", "| --- | --- | --- | --- | --- | --- | --- |"]
        for item in items:
            contract = contract_by_id.get(item["id"], {})
            url = contract.get("url") or item.get("url") or "待采集"
            headings = "、".join(contract.get("headings", [])) or "无"
            buttons = "、".join(contract.get("buttons", [])) or "无"
            evidence = contract.get("evidence") or item["navigationEvidence"]
            link = f"../../../references/risemap-capture/{evidence}.png"
            workbook.append(f"| {item['id']} | {item['name']} | `{url}` | {headings} | {buttons} | [截图]({link}) | 首屏已采集，流程未验证 |")
        workbook += ["", "## 深度走查记录", ""]
        records = [row for row in deep_records if feature_by_id[row["featureId"]]["category"] == category and feature_by_id[row["featureId"]]["group"] == group]
        if not records:
            workbook.append("尚无深度操作记录。没有实际操作证据的规则保持待验证。")
        else:
            workbook += ["| 记录 | 功能 | 阶段 | 操作 | 实际结果 | 业务影响 | 证据 |", "| --- | --- | --- | --- | --- | --- | --- |"]
            for record in records:
                step = step_by_id[record["evidenceStep"]]
                evidence_link = f"../../../references/risemap-capture/{step['screenshot']}"
                workbook.append(f"| {record['recordId']} | {record['featureId']} | {record['stage']} | {record['action']} | {record['result']} | {record['businessImpact']} | [截图]({evidence_link}) |")
        (category_dir / filename).write_text("\n".join(workbook) + "\n")
    vertical_index.append("")
(DOCS / "risemap" / "README.md").write_text("\n".join(vertical_index) + "\n")

journeys = """# RISEMAP 跨功能纵向主线

以下是根据菜单和官方引导形成的走查路线，仍需实际操作确认每个转换、金额、库存和状态关系。

| 主线 | 顺序 | 当前状态 |
| --- | --- | --- |
| 销售到回款 | 客户与联系人 → 商机 → 报价 → 框架销售合同 → 销售订单 → 发货或出库 → 销项发票 → 应收 → 收款 | 入口首屏完成，转换和核销待验证 |
| 采购到付款 | 采购申请 → 待办池 → 询价 → 供应商价格本 → 采购订单 → 到货通知与登记 → 检验 → 采购入库 → 进项发票 → 应付 → 付款 | 入口首屏完成，完整链路待验证 |
| BOM到组装 | 物料与BOM → 组装单 → 缺料 → 领料或补料 → 退料、拆解或换件 → 生产入库与出库 → SN追溯 | 入口首屏完成，数量和批次待验证 |
| 图纸生命周期 | 图号档案 → 评审 → 发布 → 发放 → 变更 → 关联查询 → 客户图纸 | 官方指南和入口首屏完成，版本约束待验证 |
| 委外加工 | 委外供应商 → 订单 → 发料 → 委外库存 → 回厂 → 检验或入库 → 退料 → 对账与报表 | 官方指南和入口首屏完成，库存与结算待验证 |
| 项目到经营结果 | 项目 → 任务与甘特图 → 工时 → 采购、费用与收入 → 成本利润分析 → 项目统计 | 入口首屏完成，跨模块归集待验证 |
| 入职到考勤薪酬 | 员工档案 → 入职 → 账号角色 → 班次与考勤 → 请假加班出差 → 薪酬福利 → 离职 | 入口首屏完成，审批与权限待验证 |
| 行政资产与设备 | 采购或入库 → 固定资产、办公物料、车辆或设备 → 领用、借出、维护 → 费用和审批 | 入口首屏完成，资产状态和财务连接待验证 |
| 系统上线 | 企业与部门 → 员工与账号 → 权限 → 基础字典 → 期初建账 → 编码审批通知 → 销售和采购试跑 | 初始化8项完成，引导25步尚未办理 |
"""
(DOCS / "risemap" / "journeys.md").write_text(journeys)

presets = []
for row in steps:
    if row["id"] == "019-preset-asset-category-expanded" or re.fullmatch(r"\d{3}-preset-\d{2}", row["id"]):
        state = (BASE / row["state"]).read_text()
        label = "资产分类 固定资产分类体系配置 9  项" if row["id"].startswith("019-") else row["label"].removeprefix("展开预设配置 ")
        lines = state.splitlines()
        i = next(i for i, line in enumerate(lines) if " text " + label in line)
        value_line = lines[i + 3]
        assert " text " in value_line, (row["id"], value_line)
        values = value_line.split(" text ", 1)[1]
        presets.append({"name": label.split(" ", 1)[0], "description": label, "displayValues": values,
                        "evidence": row["id"], "note": "页面展示标签，内部编码与业务约束待核对"})
(DOCS / "risemap-preset-dictionaries.json").write_text(json.dumps(presets, ensure_ascii=False, indent=2) + "\n")
dictionary_md = ["# RISEMAP 预设业务字典", "", "55项配置逐项展开采集。下列为页面展示值，内部编码、默认值、排序及业务约束仍需在各业务模块中核对。", "", "| 字典 | 页面展示选项 | 证据 |", "| --- | --- | --- |"]
for item in presets:
    dictionary_md.append(f"| {item['name']} | {item['displayValues']} | [截图](references/risemap-capture/{item['evidence']}.png) |")
(DOCS / "risemap-preset-dictionaries.md").write_text("\n".join(dictionary_md) + "\n")
print(json.dumps({"steps": len(steps), "screenshots": sum(row["file"].endswith(".png") for row in manifest),
                  "menuEntries": len(inventory), "dictionaries": len(presets),
                  "initialPagesCaptured": sum(item["status"] == "initial_page_captured" for item in inventory),
                  "pageContracts": len(contracts), "verticalWorkbooks": len(group_slugs),
                  "deepRecords": len(deep_records)}, ensure_ascii=False))
