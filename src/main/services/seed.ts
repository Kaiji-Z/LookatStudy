/**
 * 种子课程加载器 —— 把 Awesome-FDE-Roadmap 的 README 结构转成课程树。
 *
 * 这是 dogfood 案例：M0 完成后用户启动就能看到真实课程，不是空状态。
 * 来源：调研阶段拿到的 README H2/H3 结构。
 *
 * M4 实现 course generator 后，这个种子就用通用流程替代。
 */
import { getDb, markDirty } from "../db/index.js";
import { courses, contentNodes, progress as progressTable } from "../db/schema.js";
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";

interface SeedSection {
  title: string;
  anchor: string;
  lessons: { title: string; anchor: string }[];
}

const FDE_SEED: SeedSection[] = [
  {
    title: "The FDE Persona & Mission",
    anchor: "the-fde-persona--mission",
    lessons: [
      { title: "The Modern FDE Stack", anchor: "the-modern-fde-stack" },
      { title: "The Master Curriculum", anchor: "the-master-curriculum" },
      { title: "Phase 1: Data Engineering (The Bedrock)", anchor: "phase-1-data-engineering-the-bedrock" },
      { title: "Phase 2: Cloud Architecture & Infrastructure", anchor: "phase-2-cloud-architecture--infrastructure-the-vehicle" },
      { title: "Phase 3: The Consulting Mindset", anchor: "phase-3-the-consulting-mindset-the-forward-in-fde" },
    ],
  },
  {
    title: "Applied AI & Technical Playbook",
    anchor: "the-applied-ai--technical-playbook",
    lessons: [
      { title: "Industry Intelligence (The Gold Standard)", anchor: "industry-intelligence-the-gold-standard" },
      { title: "Multi-Agent Orchestration with Google ADK", anchor: "multi-agent-orchestration-with-google-adk" },
      { title: "LLM Systems Evaluation (The Success Key)", anchor: "llm-systems-evaluation-the-success-key" },
      { title: "The Enterprise RAG Blueprint", anchor: "the-enterprise-rag-blueprint" },
      { title: "The FDE Technical Deep-Dives", anchor: "the-fde-technical-deep-dives" },
    ],
  },
  {
    title: "Air-Gapped & Tactical Edge Deployment",
    anchor: "air-gapped--tactical-edge-deployment",
    lessons: [
      { title: "The Compliance Bedrock", anchor: "the-compliance-bedrock" },
      { title: "Offline Model Weights & Package Mirrors", anchor: "offline-model-weights--package-mirrors" },
      { title: "Hardened Container Registries", anchor: "hardened-container-registries" },
      { title: "Sync-Back & Cross-Domain Patterns", anchor: "sync-back--cross-domain-patterns" },
      { title: "The Edge Runtime Stack", anchor: "the-edge-runtime-stack" },
      { title: "Air-Gap-Specific Failure Modes", anchor: "air-gap-specific-failure-modes" },
    ],
  },
  {
    title: 'The "Soft Stack": Consulting & Strategy',
    anchor: "the-soft-stack-consulting--strategy",
    lessons: [
      { title: "The Diagnostic Mindset", anchor: "the-diagnostic-mindset" },
      { title: 'The "Forward Deployment" Discovery Checklist', anchor: "the-forward-deployment-discovery-checklist" },
      { title: "Strategic Frameworks", anchor: "strategic-frameworks" },
      { title: "Practical Scoping & Artifacts", anchor: "practical-scoping--artifacts" },
      { title: "Red Flags for FDEs", anchor: "red-flags-for-fdes" },
    ],
  },
  {
    title: "The Interview Blackbook & Case Studies",
    anchor: "the-interview-blackbook--case-studies",
    lessons: [
      { title: 'The "C.A.S.E." Framework for FDE Interviews', anchor: "the-case-framework-for-fde-interviews" },
      { title: 'The "Delta" Case Study: Hospital Readmission', anchor: "the-delta-case-study-hospital-readmission" },
      { title: "High-Frequency Interview Questions", anchor: "high-frequency-interview-questions" },
      { title: "Real-World Case Studies to Study", anchor: "real-world-case-studies-to-study" },
    ],
  },
  {
    title: "Artifact Templates (Copy-Paste)",
    anchor: "artifact-templates-copy-paste",
    lessons: [
      { title: 'The "Site Survey" (Discovery Report)', anchor: "1-the-site-survey-discovery-report" },
      { title: "The Technical Scoping & PRD", anchor: "2-the-technical-scoping--prd" },
      { title: "The Agentic Deployment Architecture (GCP)", anchor: "3-the-agentic-deployment-architecture-gcp" },
      { title: 'The Executive Status Report ("WES")', anchor: "4-the-executive-status-report-the-wes" },
    ],
  },
  {
    title: "Comprehensive Reading List",
    anchor: "comprehensive-reading-list",
    lessons: [
      { title: 'The FDE "Canon" (Core Books)', anchor: "the-fde-canon-core-books" },
      { title: "The Fundamental Whitepapers", anchor: "the-fundamental-whitepapers" },
      { title: "Podcasts: Learning on the Go", anchor: "podcasts-learning-on-the-go" },
      { title: "Newsletters: The Daily Pulse", anchor: "newsletters-the-daily-pulse" },
      { title: "High-Signal Blogs", anchor: "high-signal-blogs" },
    ],
  },
];

const COURSE_ID = "seed-fde-roadmap";
const COURSE_REPO_URL = "https://github.com/pierpaolo28/Awesome-FDE-Roadmap";

export function ensureSeedCourse(): void {
  const db = getDb();

  const existing = db
    .select()
    .from(courses)
    .where(eq(courses.id, COURSE_ID))
    .get();

  if (existing) return; // 已种子化

  db.insert(courses)
    .values({
      id: COURSE_ID,
      repoUrl: COURSE_REPO_URL,
      repoName: "Awesome-FDE-Roadmap",
      title: "Forward Deployment Engineer 学习路线图",
      description:
        "成为 Forward Deployment Engineer (FDE) 的权威路线图：掌握 AI Agents、企业数据架构、战略咨询。FDE 是把前沿 AI 能力落地到客户真实场景的工程角色。",
      version: 1,
    })
    .run();

  let orderIdx = 0;
  for (const section of FDE_SEED) {
    const sectionId = randomUUID();
    db.insert(contentNodes)
      .values({
        id: sectionId,
        courseId: COURSE_ID,
        parentId: null,
        type: "section",
        title: section.title,
        sourcePath: `README.md#${section.anchor}`,
        orderIdx: orderIdx++,
      })
      .run();

    // 第一个 section 的第一个 lesson 设为 available，其余 locked
    let lessonOrder = 0;
    for (const lesson of section.lessons) {
      const lessonId = randomUUID();
      const isFirstEver = orderIdx === 1 && lessonOrder === 0;
      db.insert(contentNodes)
        .values({
          id: lessonId,
          courseId: COURSE_ID,
          parentId: sectionId,
          type: "lesson",
          title: lesson.title,
          sourcePath: `README.md#${lesson.anchor}`,
          orderIdx: lessonOrder++,
        })
        .run();

      db.insert(progressTable)
        .values({
          nodeId: lessonId,
          status: isFirstEver ? "available" : "locked",
          crownLevel: 0,
        })
        .run();
    }
  }
  markDirty();
}
