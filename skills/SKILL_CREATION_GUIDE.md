# 技能创建与使用指南

## 一、技能系统概述

PIweb 的技能系统允许你通过创建简单的 Markdown 文件来扩展 AI 的行为模式。每个技能文件都放在 `skills/` 目录下。

## 二、技能文件格式

每个技能文件必须包含 Frontmatter 元数据和技能内容：

```markdown
---
name: skill-name
description: 简短描述这个技能的作用
---

# 技能标题

## 功能说明
详细描述这个技能的功能和用途。

## 使用场景
- 场景 1
- 场景 2

## 操作步骤
1. 第一步做什么
2. 第二步做什么

## 注意事项
- 注意点 1
- 注意点 2
```

## 三、创建新技能

### 步骤 1：创建技能文件

在 `skills/` 目录下创建新的 `.md` 文件，例如：

```bash
# Windows
echo --- > skills\my-skill.md
echo name: my-skill >> skills\my-skill.md
echo description: 我的自定义技能 >> skills\my-skill.md
echo --- >> skills\my-skill.md
echo. >> skills\my-skill.md
echo # 我的技能 >> skills\my-skill.md
echo 这里是技能内容... >> skills\my-skill.md
```

### 步骤 2：技能内容示例

**示例 1：代码审查技能**

```markdown
---
name: code-review
description: 专业的代码审查技能，检查代码质量、安全性和最佳实践
---

# 代码审查技能

## 审查要点
- 代码可读性和命名规范
- 错误处理和边界条件
- 性能优化建议
- 安全漏洞检查
- 设计模式应用

## 审查流程
1. 理解代码功能和上下文
2. 逐行检查代码逻辑
3. 识别潜在问题
4. 提供改进建议
5. 给出总体评价
```

**示例 2：数据分析技能**

```markdown
---
name: data-analysis
description: 专业数据分析技能，进行统计分析、趋势识别和洞察发现
---

# 数据分析技能

## 分析能力
- 描述性统计分析
- 趋势和模式识别
- 异常值检测
- 相关性分析
- 数据可视化建议

## 工作流程
1. 理解数据背景和目标
2. 数据清洗和预处理
3. 探索性数据分析
4. 统计检验
5. 结论和建议
```

## 四、使用技能

### 方法 1：通过 skill_run 工具

```
使用 skill_run 工具直接执行技能：

skill_run({
  skill: "skill-name",
  task: "要完成的任务"
})
```

**示例：**
```
skill_run({
  skill: "code-review",
  task: "请审查以下代码：[代码内容]"
})
```

### 方法 2：通过 skill_list 查看可用技能

```
skill_list()
```

返回所有可用技能列表。

### 方法 3：在 Grid 任务中使用技能

Grid 系统在执行计划时会自动应用相关技能：

```
grid_run({
  goal: "完成一个复杂任务",
  constraints: "使用 code-review 和 data-visualization 技能"
})
```

## 五、技能激活机制

技能通过以下方式影响 AI 行为：

1. **直接执行**：使用 `skill_run` 工具时，技能内容作为 prompt 修饰符
2. **Grid 集成**：Grid 规划时自动选择适用技能
3. **会话激活**：在 Web 或 CLI 中激活技能后，技能内容会注入到系统 prompt 中

## 六、现有技能列表

当前项目已有的技能：

| 技能名称 | 描述 |
|---------|------|
| web-browser | 网页浏览和数据抓取 |
| data-visualization | 数据可视化和图表创建 |
| deep-research | 深度调研和信息搜集 |
| file-manager | 文件管理和保存 |
| cuda-expert | CUDA 编程专家 |
| bug-tracker | Bug 追踪和管理 |
| desktop-path | 桌面路径处理 |
| tarot-reading | 塔罗牌解读 |
| astrology-reader | 占星术解读 |
| divination-general | 占卜通用 |
| international-box-office-research | 国际票房研究 |

## 七、最佳实践

1. **技能命名**：使用短横线命名法（kebab-case），如 `code-review`
2. **描述清晰**：description 应该简洁明了地说明技能用途
3. **内容结构化**：使用 Markdown 标题和列表组织内容
4. **可操作性**：技能内容应该是可执行的指令，不是理论说明
5. **工具配合**：明确说明技能会使用哪些工具（read_file, bash, web_fetch 等）

## 八、技能热加载

技能系统支持热加载，无需重启服务：

1. 在 `skills/` 目录添加/修改技能文件
2. 调用 `skill_list` 或刷新 Web 界面
3. 新技能立即可用

## 九、技能与 Grid 集成

在 Grid 规划中，系统会自动：

1. 扫描所有可用技能
2. 为每个步骤选择合适的技能
3. 检测技能缺口（需要的技能不存在）
4. 提示用户创建缺失的技能

## 十、调试技能

如果技能不工作：

1. 检查 Frontmatter 格式是否正确（`---` 分隔符）
2. 确认 `name` 和 `description` 字段存在
3. 确保文件名与 `name` 字段一致
4. 查看 `src/skills.ts` 的加载逻辑
