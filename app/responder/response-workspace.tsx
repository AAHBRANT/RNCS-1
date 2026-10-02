"use client";

import { MouseEvent, useEffect, useMemo, useRef, useState } from "react";
import { Eye, FileText, History, TriangleAlert, X } from "lucide-react";
import { Sidebar } from "../components/sidebar";
import { Topbar } from "../components/topbar";
import { useSidebarCollapse } from "../../lib/use-sidebar-collapse";
import {
  PAM_TYPOLOGIES,
  RESPONSE_TYPES,
  RESPONSE_TYPE_LABELS,
  emptyPamFormData,
  isRejectedStatus,
  parsePamFormData,
  responseLabel,
  typologiesFromRncType,
  type PamFormData,
  type ResponseType,
} from "../../lib/response-types";
import { buildItems, rncLabel as plannerRncLabel, type PlannerApiData } from "../../lib/planner-view";
import { IdentifiedDeadlines } from "../planner/identified-deadlines";
import {
  TIMELINE_BADGE,
  buildTimeline,
  describeVersion,
  timelineToText,
  type TimelineItem,
} from "../../lib/rnc-timeline";

type RncListItem = {
  id: number; number: string; year: number; description: string; status: string;
};
type RncDetail = RncListItem & {
  workName: string; type: string; receivedAt: string | null; dueAt: string | null;
  sentAt: string | null; returnedAt: string | null; responseOwner: string;
  inspectionOwner: string; contract: string; analysisOwner: string;
};
type EmailEvent = {
  id: number; subject: string | null; eventType: string; occurredAt: string;
  attachmentMetadata: string | null; summary?: string | null;
};
type AuditChange = {
  id: number; field: string; oldValue: string | null; newValue: string | null; changedAt: string; userName?: string | null;
};
type Attachment = {
  id: string; name: string; extractedText?: string; extractionMethod?: string;
  pageCount?: number; needsOcr?: boolean; eventId?: number;
};
type Draft = {
  directive: string; analysis: string; actionsTaken: string; technicalResponse: string;
  evidence: string; conclusion: string; agentResponse: string; emailBody: string;
  locationFront: string; contract: string; observations: string;
  photoLegend1: string; photoLegend2: string; photoLegend3: string; photoLegend4: string;
  internalComment: string; selectedAttachments: string; status: string; updatedAt?: string;
  updatedBy?: string;
};
type Version = {
  id: number; version: number; snapshot: string; createdAt: string; createdBy?: string;
  responseType?: string; responseSequence?: number;
};
type DraftSummary = { responseType: string; status: string; updatedAt?: string };
type WordDocument = {
  id: number; version: number; fileName: string; size: number; uploadedBy: string; createdAt: string;
  responseType?: string;
};
type AccessUser = { name: string; email: string; role: "admin" | "drafter" | "reviewer_approver" };

const emptyDraft: Draft = {
  directive: "", analysis: "", actionsTaken: "", technicalResponse: "",
  evidence: "", conclusion: "", agentResponse: "", emailBody: "",
  locationFront: "", contract: "", observations: "",
  photoLegend1: "", photoLegend2: "", photoLegend3: "", photoLegend4: "",
  internalComment: "",
  selectedAttachments: "[]", status: "Rascunho",
};

function defaultTypeForStatus(status?: string): ResponseType {
  return status && /^PAM/.test(status) ? "PAM" : "TRATATIVA";
}

function todayIso() {
  return new Date().toLocaleDateString("sv-SE");
}

function pamDefaultsFromRnc(rnc: RncDetail): PamFormData {
  return {
    contract: rnc.contract || "",
    typologies: typologiesFromRncType(rnc.type),
    occurrenceDescription: rnc.description || "",
    improvementProposal: "",
    date: todayIso(),
    responsible: rnc.responseOwner || "",
    deadline: "",
  };
}

function formatDate(value?: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("pt-BR").format(
    value.length === 10 ? new Date(`${value}T12:00:00`) : new Date(value),
  );
}

function attachmentsFromEmails(emails: EmailEvent[]) {
  const attachments = emails.flatMap((email) => {
    try {
      return (JSON.parse(email.attachmentMetadata || "[]") as Attachment[])
        .map((attachment) => ({ ...attachment, eventSubject: email.subject || email.eventType, eventId: email.id }));
    } catch {
      return [];
    }
  });
  return [...new Map(attachments.map((item) => [item.id || item.name, item])).values()];
}

export function ResponseWorkspace() {
  const [collapsed, toggleCollapsed] = useSidebarCollapse();
  const [outlook, setOutlook] = useState({ configured: false, connected: false });
  const [rncs, setRncs] = useState<RncListItem[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [rnc, setRnc] = useState<RncDetail | null>(null);
  const [emails, setEmails] = useState<EmailEvent[]>([]);
  const [documents, setDocuments] = useState<WordDocument[]>([]);
  const [responseType, setResponseType] = useState<ResponseType>("TRATATIVA");
  const [typeChosen, setTypeChosen] = useState(false);
  const [draftSummaries, setDraftSummaries] = useState<DraftSummary[]>([]);
  const [allVersions, setAllVersions] = useState<Version[]>([]);
  const [pam, setPam] = useState<PamFormData>({ ...emptyPamFormData });
  const [initialPam, setInitialPam] = useState<PamFormData>({ ...emptyPamFormData });
  const [plannerData, setPlannerData] = useState<PlannerApiData | null>(null);
  const [plannerBusy, setPlannerBusy] = useState(false);
  const [historyChanges, setHistoryChanges] = useState<AuditChange[]>([]);
  const [allDocuments, setAllDocuments] = useState<WordDocument[]>([]);
  const [viewingVersion, setViewingVersion] = useState<Version | null>(null);
  const [pendingType, setPendingType] = useState<ResponseType | null>(null);
  const [switchConfirmType, setSwitchConfirmType] = useState<ResponseType | null>(null);
  const [photos, setPhotos] = useState<Array<File | null>>([null, null, null, null]);
  const [previewDocument, setPreviewDocument] = useState<WordDocument | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [previewZoom, setPreviewZoom] = useState(100);
  const [previewPdfUrl, setPreviewPdfUrl] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [selectedAttachments, setSelectedAttachments] = useState<string[]>([]);
  const [activePanel, setActivePanel] = useState<"documents" | "versions" | "viewer" | null>(null);
  const [viewingAttachment, setViewingAttachment] = useState<{ eventId: number; id: string; name: string } | null>(null);
  function togglePanel(panel: "documents" | "versions" | "viewer") {
    setActivePanel((current) => (current === panel ? null : panel));
  }
  function viewAttachment(attachment: Attachment) {
    if (!attachment.eventId) return;
    setViewingAttachment({ eventId: attachment.eventId, id: attachment.id, name: attachment.name });
    setActivePanel("viewer");
  }
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [accessUser, setAccessUser] = useState<AccessUser | null>(null);
  const [initialDraftSnapshot, setInitialDraftSnapshot] = useState<Draft>(emptyDraft);
  const [initialPhotosSnapshot, setInitialPhotosSnapshot] = useState<Array<File | null>>([null, null, null, null]);
  const [initialSelectedAttachmentsSnapshot, setInitialSelectedAttachmentsSnapshot] = useState<string[]>([]);
  const [showConfirmDiscard, setShowConfirmDiscard] = useState(false);
  const [pendingNavigation, setPendingNavigation] = useState<"rnc" | "panel" | "href" | "work" | "type" | null>(null);
  const [pendingRncId, setPendingRncId] = useState("");
  const [pendingHref, setPendingHref] = useState("");
  const [pendingWorkId, setPendingWorkId] = useState<number | null>(null);
  const [works, setWorks] = useState<Array<{ id: number; name: string; accessible: boolean }>>([]);
  const [activeWorkId, setActiveWorkId] = useState<number | null>(null);
  const documentInput = useRef<HTMLInputElement>(null);

  function selectRnc(id: string, list: RncListItem[]) {
    const item = list.find((entry) => String(entry.id) === id);
    setSelectedId(id);
    setResponseType(defaultTypeForStatus(item?.status));
    setTypeChosen(false);
  }

  async function loadRncs() {
    try {
      const response = await fetch("/api/rncs");
      const data = await response.json();
      const available = (data.rncs || []).filter((item: RncListItem) => item.status !== "Aprovada");
      setRncs(available);
      if (data.works) setWorks(data.works);
      if ("activeWorkId" in data) setActiveWorkId(data.activeWorkId ?? null);
      const requested = new URLSearchParams(window.location.search).get("rnc");
      const initial = available.some((item: RncListItem) => String(item.id) === requested)
        ? requested
        : available[0] ? String(available[0].id) : "";
      const params = new URLSearchParams(window.location.search);
      const typeParam = params.get("type");
      const explicitType = typeParam === "PAM" || typeParam === "TRATATIVA" ? typeParam : null;
      setSelectedId(initial || "");
      setResponseType(explicitType ?? defaultTypeForStatus(available.find((item: RncListItem) => String(item.id) === initial)?.status));
      setTypeChosen(Boolean(explicitType));
      const panelParam = params.get("panel");
      if (panelParam === "versions" || panelParam === "documents") setActivePanel(panelParam);
    } catch {
      setNotice("Não foi possível carregar as RNCs.");
    }
  }

  async function switchWork(id: number) {
    const response = await fetch(`/api/works/${id}/select`, { method: "POST" });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      setNotice(data.error || "Não foi possível trocar de obra.");
      return;
    }
    await loadRncs();
  }

  function requestSwitchWork(id: number) {
    if (id === activeWorkId) return;
    if (hasUnsavedChanges) {
      setPendingNavigation("work");
      setPendingWorkId(id);
      setShowConfirmDiscard(true);
    } else {
      switchWork(id);
    }
  }

  useEffect(() => {
    if (!previewDocument) return;
    setPreviewZoom(window.innerWidth >= 900 ? 100 : window.innerWidth >= 650 ? 80 : 60);
  }, [previewDocument]);

  useEffect(() => {
    fetch("/api/outlook/status")
      .then((response) => response.json())
      .then((data) => { if (!data.error) setOutlook(data); })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    loadRncs();
  }, []);

  useEffect(() => {
    if (!selectedId) return;
    queueMicrotask(() => setBusy(true));
    window.history.replaceState({}, "", `/responder/editor?rnc=${selectedId}`);
    Promise.all([
      fetch(`/api/rncs/${selectedId}/response?type=${responseType}`).then(async (response) => ({ response, data: await response.json() })),
      fetch(`/api/rncs/${selectedId}/response/document?type=${responseType}`).then((response) => response.json()),
      fetch(`/api/rncs/${selectedId}/history`).then((response) => response.json()).catch(() => ({})),
    ])
      .then(([{ response, data }, documentData, historyData]) => {
        if (!response.ok) throw new Error(data.error || "Não foi possível abrir a RNC.");
        setHistoryChanges(historyData?.changes || []);
        setAllDocuments(historyData?.documents || []);
        setRnc(data.rnc);
        setEmails(data.emails || []);
        setAllVersions(data.allVersions || []);
        setDraftSummaries(data.drafts || []);
        setAccessUser(data.user || null);
        setDocuments(documentData.documents || []);
        setPhotos([null, null, null, null]);
        const loaded = data.draft || emptyDraft;
        const draftWithDefaults = { ...emptyDraft, ...loaded };
        setDraft(draftWithDefaults);
        setInitialDraftSnapshot(draftWithDefaults);
        setInitialPhotosSnapshot([null, null, null, null]);
        const pamValue = responseType === "PAM"
          ? (data.draft ? parsePamFormData(data.draft.formData) : pamDefaultsFromRnc(data.rnc))
          : { ...emptyPamFormData };
        setPam(pamValue);
        setInitialPam(pamValue);
        try {
          const attachments = JSON.parse(loaded.selectedAttachments || "[]");
          setSelectedAttachments(attachments);
          setInitialSelectedAttachmentsSnapshot(attachments);
        } catch {
          setSelectedAttachments([]);
          setInitialSelectedAttachmentsSnapshot([]);
        }
      })
      .catch((error) => setNotice(error instanceof Error ? error.message : "Falha ao abrir a RNC."))
      .finally(() => setBusy(false));
  }, [selectedId, responseType]);

  const attachments = useMemo(() => attachmentsFromEmails(emails), [emails]);

  const timeline = useMemo(() => buildTimeline({
    emails, versions: allVersions, documents: allDocuments, changes: historyChanges,
  }), [emails, allVersions, allDocuments, historyChanges]);

  async function refreshHistory(rncId: number) {
    try {
      const data = await fetch(`/api/rncs/${rncId}/history`).then((item) => item.json());
      setHistoryChanges(data.changes || []);
      setAllDocuments(data.documents || []);
    } catch {
      // O histórico é complementar; falha aqui não deve interromper o salvamento.
    }
  }

  const plannerRncId = rnc?.id ?? null;

  async function loadPlanner(rncId: number) {
    try {
      const response = await fetch(`/api/planner?rncId=${rncId}`, { cache: "no-store" });
      if (!response.ok) return;
      setPlannerData((await response.json()) as PlannerApiData);
    } catch {
      // Os prazos identificados são complementares; falha aqui não interrompe a resposta.
    }
  }

  async function confirmPlannerPam(pamId: number) {
    setPlannerBusy(true);
    try {
      const response = await fetch(`/api/planner/pams/${pamId}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "confirm" }) });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Não foi possível confirmar a interpretação.");
      setNotice("Interpretação dos prazos confirmada. Ela alimenta apenas o Planner; o PAM não foi alterado.");
      if (plannerRncId) await loadPlanner(plannerRncId);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Não foi possível confirmar a interpretação.");
    } finally {
      setPlannerBusy(false);
    }
  }

  function openTimelineItem(item: TimelineItem) {
    if (item.ref?.type === "version") {
      const target = allVersions.find((version) => version.id === item.ref!.id);
      if (target) setViewingVersion(target);
    } else if (item.ref?.type === "document") {
      const target = allDocuments.find((document) => document.id === item.ref!.id);
      if (target) setPreviewDocument(target);
    }
  }

  const hasUnsavedChanges = useMemo(() => {
    const pamChanged = responseType === "PAM" && JSON.stringify(pam) !== JSON.stringify(initialPam);
    if (JSON.stringify(initialDraftSnapshot) === JSON.stringify(emptyDraft)) return pamChanged;
    const draftChanged = JSON.stringify(draft) !== JSON.stringify(initialDraftSnapshot);
    const attachmentsChanged = JSON.stringify(selectedAttachments) !== JSON.stringify(initialSelectedAttachmentsSnapshot);
    const photosChanged = photos.some((photo, i) => {
      const initialPhoto = initialPhotosSnapshot[i];
      return (photo === null) !== (initialPhoto === null) || (photo !== null && initialPhoto !== null && photo.name !== initialPhoto.name);
    });
    return draftChanged || attachmentsChanged || photosChanged || pamChanged;
  }, [draft, selectedAttachments, photos, pam, initialPam, responseType, initialDraftSnapshot, initialSelectedAttachmentsSnapshot, initialPhotosSnapshot]);

  const showTypeSwitch = Boolean(rnc) && (
    isRejectedStatus(rnc?.status || "")
    || /^PAM/.test(rnc?.status || "")
    || draftSummaries.some((item) => item.responseType === "PAM")
  );
  const showChooser = Boolean(rnc) && isRejectedStatus(rnc?.status || "") && !typeChosen;

  useEffect(() => {
    const handler = (event: BeforeUnloadEvent) => {
      if (hasUnsavedChanges) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [hasUnsavedChanges]);

  useEffect(() => {
    if (!rnc || !previewDocument) return;
    let active = true;
    let objectUrl: string | null = null;
    queueMicrotask(() => setPreviewing(true));
    fetch(`/api/rncs/${rnc.id}/response/document?document=${previewDocument.id}`)
      .then(async (response) => {
        if (!response.ok) {
          const contentType = response.headers.get("content-type") || "";
          const data = contentType.includes("application/json") ? await response.json() : {};
          throw new Error(data.error || "Não foi possível abrir o documento.");
        }
        return response.arrayBuffer();
      })
      .then(async (buffer) => {
        if (!active) return;
        const { convertDocxToPdfBlob } = await import("../../lib/docx-to-pdf-preview");
        const pdfBlob = await convertDocxToPdfBlob(buffer);
        if (!active) return;
        objectUrl = URL.createObjectURL(pdfBlob);
        setPreviewPdfUrl(objectUrl);
      })
      .catch((error) => {
        if (active) setNotice(error instanceof Error ? error.message : "Não foi possível abrir o documento.");
      })
      .finally(() => {
        if (active) setPreviewing(false);
      });
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      setPreviewPdfUrl(null);
    };
  }, [previewDocument, rnc]);

  useEffect(() => {
    if (!plannerRncId || responseType !== "PAM") return;
    let active = true;
    fetch(`/api/planner?rncId=${plannerRncId}`, { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((payload) => { if (active && payload) setPlannerData(payload as PlannerApiData); })
      .catch(() => undefined);
    return () => { active = false; };
  }, [plannerRncId, responseType, allVersions.length]);

  function update(field: keyof Draft, value: string) {
    setDraft((current) => ({ ...current, [field]: value }));
  }

  function contextForAgent() {
    if (!rnc) return "";
    const selected = attachments.filter((attachment) => selectedAttachments.includes(attachment.id || attachment.name));
    const attachmentText = selected.map((attachment) => [
      `DOCUMENTO: ${attachment.name}`,
      attachment.extractedText?.slice(0, 10_000) || "Texto não disponível; considerar o documento indicado manualmente.",
    ].join("\n")).join("\n\n");
    const isPam = responseType === "PAM";
    const responseFields = isPam
      ? [
        `Tipologia da ocorrência: ${pam.typologies.join(", ") || "Ainda não selecionada"}`,
        `Descrição da ocorrência (PAM): ${pam.occurrenceDescription || "Ainda não preenchida"}`,
        `Descrição da proposta de melhoria: ${pam.improvementProposal || "Ainda não preenchida"}`,
        `Prazo para o PAM: ${pam.deadline || "Ainda não definido"}`,
      ]
      : [
        `Análise da ocorrência: ${draft.analysis || "Ainda não preenchida"}`,
        `Medidas corretivas: ${draft.actionsTaken || "Ainda não preenchidas"}`,
        `Observações: ${draft.observations || "Sem observações"}`,
      ];
    const clip = (value: string, size: number) => (value.length > size ? `${value.slice(0, size)}…` : value);
    const lastReturn = [...emails]
      .filter((email) => email.eventType === "retorno_supervisao")
      .sort((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt))[0];
    const lastTratativa = allVersions.find((version) => version.responseType === "TRATATIVA");
    const previousTratativa = lastTratativa ? describeVersion(lastTratativa) : null;
    const pamContext = !isPam ? [] : [
      lastReturn
        ? `Reprovação anterior (${formatDate(lastReturn.occurredAt)} — ${lastReturn.subject || "retorno da Supervisão"}):\n${clip(lastReturn.summary || "Texto do retorno não disponível; consultar o documento no dossiê.", 3_000)}`
        : "Reprovação anterior: retorno da Supervisão não localizado no histórico.",
      previousTratativa
        ? `Tratativa anterior (${previousTratativa.label}):\n${previousTratativa.fields.filter((field) => field.value && field.label !== "Comentário interno").map((field) => `${field.label}: ${clip(field.value, 2_000)}`).join("\n")}`
        : "Tratativa anterior: nenhuma tratativa registrada.",
      `Histórico da RNC:\n${timelineToText(timeline, (value) => formatDate(value)) || "Sem eventos registrados."}`,
    ];
    return [
      "ELABORAÇÃO DE RESPOSTA TÉCNICA — RNC",
      isPam ? "TIPO DE RESPOSTA: PAM – PLANO DE AÇÃO DE MELHORIA" : "TIPO DE RESPOSTA: TRATATIVA DA RNC",
      `RNC: ${rnc.number}/${rnc.year}`,
      `Obra: ${rnc.workName}`,
      `Descrição: ${rnc.description}`,
      `Tipo: ${rnc.type}`,
      `Recebimento: ${formatDate(rnc.receivedAt)}`,
      `Prazo: ${formatDate(rnc.dueAt)}`,
      `Responsável da área inspecionada: ${rnc.responseOwner || "Não identificado"}`,
      `Responsável fiscal pela inspeção: ${rnc.inspectionOwner || "Não identificado"}`,
      `Contrato: ${rnc.contract || "Não identificado"}`,
      `Status atual: ${rnc.status}`,
      ...responseFields,
      ...pamContext,
      selected.length ? `Documentos selecionados:\n${attachmentText}` : "Documentos selecionados: nenhum",
      "Elabore uma minuta técnica para revisão, sem enviar e-mail e sem inventar informações ausentes.",
    ].join("\n\n");
  }

  async function copyContext() {
    await navigator.clipboard.writeText(contextForAgent());
    setNotice("Contexto copiado. Abra o agente e cole as informações.");
  }

  function applyTypeSwitch(type: ResponseType, skipConfirm = false) {
    const targetHasDraft = draftSummaries.some((item) => item.responseType === type);
    const otherInProgress = draftSummaries.some(
      (item) => item.responseType !== type && item.status !== "Documento aprovado",
    );
    if (!skipConfirm && !targetHasDraft && otherInProgress) {
      setSwitchConfirmType(type);
      return;
    }
    setResponseType(type);
    setTypeChosen(true);
  }

  function requestSwitchType(type: ResponseType) {
    if (type === responseType && typeChosen) return;
    if (hasUnsavedChanges && type !== responseType) {
      setPendingNavigation("type");
      setPendingType(type);
      setShowConfirmDiscard(true);
      return;
    }
    applyTypeSwitch(type);
  }

  function handleConfirmDiscard() {
    if (pendingNavigation === "rnc" && pendingRncId) {
      selectRnc(pendingRncId, rncs);
    } else if (pendingNavigation === "type" && pendingType) {
      applyTypeSwitch(pendingType);
    } else if (pendingNavigation === "panel") {
      window.location.href = "/";
    } else if (pendingNavigation === "href" && pendingHref) {
      window.location.href = pendingHref;
    } else if (pendingNavigation === "work" && pendingWorkId) {
      switchWork(pendingWorkId);
    }
    setShowConfirmDiscard(false);
    setPendingNavigation(null);
    setPendingRncId("");
    setPendingHref("");
    setPendingWorkId(null);
    setPendingType(null);
  }

  function handleNavClickCapture(event: MouseEvent<HTMLDivElement>) {
    if (!hasUnsavedChanges) return;
    const anchor = (event.target as HTMLElement).closest("a[href]") as HTMLAnchorElement | null;
    if (!anchor) return;
    event.preventDefault();
    setPendingNavigation("href");
    setPendingHref(anchor.getAttribute("href") || "/");
    setShowConfirmDiscard(true);
  }

  async function saveDraft() {
    if (!rnc) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/rncs/${rnc.id}/response`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...draft,
          selectedAttachments,
          responseType,
          formData: responseType === "PAM" ? { ...pam, contract: rnc.contract || pam.contract } : undefined,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Não foi possível salvar.");
      setNotice(`${responseLabel(responseType, data.version)} salvo.`);
      const refreshed = await fetch(`/api/rncs/${rnc.id}/response?type=${responseType}`).then((item) => item.json());
      setAllVersions(refreshed.allVersions || []);
      setDraftSummaries(refreshed.drafts || []);
      void refreshHistory(rnc.id);
      setInitialPam(pam);
      setDraft((current) => {
        const updated = { ...current, updatedAt: data.draft.updatedAt };
        setInitialDraftSnapshot(updated);
        setInitialSelectedAttachmentsSnapshot(selectedAttachments);
        return updated;
      });
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Não foi possível salvar.");
    } finally {
      setBusy(false);
    }
  }

  async function uploadDocument(file?: File) {
    if (!rnc || !file) return;
    setBusy(true);
    try {
      const form = new FormData();
      form.set("document", file);
      form.set("responseType", responseType);
      const response = await fetch(`/api/rncs/${rnc.id}/response/document`, {
        method: "POST",
        body: form,
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Não foi possível anexar o documento.");
      const refreshed = await fetch(`/api/rncs/${rnc.id}/response/document?type=${responseType}`).then((item) => item.json());
      setDocuments(refreshed.documents || []);
      void refreshHistory(rnc.id);
      setNotice(`Documento Word salvo como versão ${data.document.version}.`);
      if (documentInput.current) documentInput.current.value = "";
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Não foi possível anexar o documento.");
    } finally {
      setBusy(false);
    }
  }

  async function generateDocument() {
    if (!rnc) return;
    setBusy(true);
    try {
      const form = new FormData();
      form.set("draft", JSON.stringify({ ...draft, formData: responseType === "PAM" ? { ...pam, contract: rnc.contract || pam.contract } : undefined }));
      form.set("responseType", responseType);
      photos.forEach((photo, index) => {
        if (photo) form.set(`photo${index + 1}`, photo);
      });
      const response = await fetch(`/api/rncs/${rnc.id}/response/generate-document`, {
        method: "POST",
        body: form,
      });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Não foi possível gerar o documento.");
      }
      const blob = await response.blob();
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = `${responseType === "PAM" ? "PAM" : "Tratativa"}_RNC_${rnc.number}_${rnc.year}.docx`;
      link.click();
      URL.revokeObjectURL(link.href);

      const saveResponse = await fetch(`/api/rncs/${rnc.id}/response`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...draft,
          selectedAttachments,
          responseType,
          formData: responseType === "PAM" ? { ...pam, contract: rnc.contract || pam.contract } : undefined,
        }),
      });
      const saveData = await saveResponse.json();
      if (!saveResponse.ok) throw new Error(saveData.error || "O Word foi gerado, mas os campos não foram salvos.");
      const [documentData, responseData] = await Promise.all([
        fetch(`/api/rncs/${rnc.id}/response/document?type=${responseType}`).then((item) => item.json()),
        fetch(`/api/rncs/${rnc.id}/response?type=${responseType}`).then((item) => item.json()),
      ]);
      setDocuments(documentData.documents || []);
      setAllVersions(responseData.allVersions || []);
      setDraftSummaries(responseData.drafts || []);
      void refreshHistory(rnc.id);
      setDraft((current) => ({ ...current, updatedAt: saveData.draft.updatedAt }));
      setNotice(`Word preenchido, salvo e baixado como versão ${response.headers.get("x-document-version") || ""}.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Não foi possível gerar o documento.");
    } finally {
      setBusy(false);
    }
  }

  function restoreVersion(version: Version) {
    try {
      const snapshot = JSON.parse(version.snapshot) as Partial<Draft> & { selectedAttachments?: string };
      const restored = { ...emptyDraft, ...snapshot };
      const attachments = JSON.parse(snapshot.selectedAttachments || "[]");
      setDraft(restored);
      setSelectedAttachments(attachments);
      setInitialDraftSnapshot(restored);
      setInitialSelectedAttachmentsSnapshot(attachments);
      if (responseType === "PAM") {
        const restoredPam = parsePamFormData((snapshot as { formData?: string }).formData);
        setPam(restoredPam);
        setInitialPam(restoredPam);
      }
      setNotice(`${responseLabel(responseType, version.version)} carregado para edição. Salve para registrar uma nova versão.`);
    } catch {
      setNotice("Não foi possível carregar esta versão.");
    }
  }

  return (
    <div className="app-shell">
      <div style={{ display: "contents" }} onClickCapture={handleNavClickCapture}>
        <Topbar activeUser={accessUser} collapsed={collapsed} onToggleCollapse={toggleCollapsed} works={works} activeWorkId={activeWorkId} onSelectWork={requestSwitchWork} />
        <Sidebar
          canCreateRnc={false}
          outlook={outlook}
          syncing={false}
          collapsed={collapsed}
          onToggleCollapse={toggleCollapsed}
          onSync={() => { window.location.href = "/"; }}
          onNewRnc={() => { window.location.href = "/"; }}
          onExportExcel={() => { window.location.href = "/"; }}
          onExportPdf={() => { window.location.href = "/"; }}
        />
      </div>
      <main className="app-main">

      <section className="response-page-heading">
        <div><p className="eyebrow">Elaboração assistida</p><h1>Responder RNC</h1><p>Organize a tratativa, utilize seu agente e mantenha as versões na mesma página.</p></div>
        <label>Selecionar RNC
          <select value={selectedId} onChange={(event) => {
            if (hasUnsavedChanges) {
              setPendingNavigation("rnc");
              setShowConfirmDiscard(true);
              setPendingRncId(event.target.value);
            } else {
              selectRnc(event.target.value, rncs);
            }
          }}>
            {rncs.map((item) => <option key={item.id} value={item.id}>RNC {item.number}/{item.year} · {item.status}</option>)}
          </select>
        </label>
      </section>

      {!rnc && <section className="response-empty">{busy ? "Carregando RNC…" : "Não há RNC disponível para resposta."}</section>}
      {rnc && showChooser && <section className="response-type-chooser">
        <div>
          <h2>Como deseja responder à reprovação?</h2>
          <p>RNC {rnc.number}/{rnc.year} · {rnc.status}. A escolha define apenas o tipo da nova resposta: nenhuma resposta anterior é apagada ou ocultada.</p>
          <div className="response-type-cards">
            {RESPONSE_TYPES.map((type) => {
              const summary = draftSummaries.find((item) => item.responseType === type);
              const last = allVersions.find((item) => item.responseType === type);
              return <button key={type} type="button" className="response-type-card" onClick={() => requestSwitchType(type)}>
                <strong>{type === "PAM" ? "Plano de Ação de Melhoria – PAM (FG 06)" : "Nova Tratativa da RNC"}</strong>
                <p>{type === "PAM"
                  ? "Elabore o PAM no formulário FG 06, com descrição da ocorrência, proposta de melhoria, responsável e prazo."
                  : "Responda com o formulário padrão de tratativa: análise da ocorrência, medidas corretivas e registro fotográfico."}</p>
                <small>{summary ? `${responseLabel(type, last?.version || 1)} · ${summary.status}` : "Nenhuma resposta deste tipo ainda"}</small>
              </button>;
            })}
          </div>
        </div>
      </section>}
      {rnc && !showChooser && <section className={`response-workspace${activePanel ? " panel-open" : ""}${activePanel === "viewer" ? " viewer-active" : ""}`}>
        <div className="response-editor">
          {hasUnsavedChanges && (
            <div className="unsaved-warning">
              <span><TriangleAlert size={14} /> Há alterações não salvas. Clique em "Salvar nova versão" para registrar.</span>
            </div>
          )}
          {showTypeSwitch && <div className="response-type-bar">
            <span>Tipo de resposta</span>
            <div className="response-type-switch" role="group" aria-label="Tipo de resposta">
              {RESPONSE_TYPES.map((type) => <button key={type} type="button" className={type === responseType ? "active" : ""} aria-pressed={type === responseType} onClick={() => requestSwitchType(type)}>
                {type === "PAM" ? "PAM (FG 06)" : RESPONSE_TYPE_LABELS[type]}
              </button>)}
            </div>
            <small>O histórico das respostas anteriores é sempre preservado.</small>
          </div>}
          <div className="editor-toolbar">
            <label>Situação do documento
              <select value={draft.status} onChange={(event) => update("status", event.target.value)}>
                <option>Rascunho</option><option>Em revisão</option>{accessUser?.role !== "drafter" && <option>Documento aprovado</option>}
              </select>
            </label>
            <span>{draft.updatedAt ? `Último salvamento: ${formatDate(draft.updatedAt)}${draft.updatedBy ? ` · ${draft.updatedBy}` : ""}` : "Ainda não salvo"}</span>
          </div>
          {responseType === "PAM" ? <>
            <section className="automatic-template-fields">
              <div><span>Nº da RNC</span><strong>{rnc.number}/{rnc.year}</strong></div>
              <div><span>Nº do contrato – obra</span><strong>{rnc.contract || "Não identificado no PDF"}</strong><small>{rnc.workName}</small></div>
              <div><span>Tipo da RNC</span><strong>{rnc.type}</strong></div>
              <div><span>Formulário</span><strong>FG 06 – Plano de Ação de Melhoria (PAM)</strong></div>
            </section>
            <section className="template-fields">
              <div><strong>Tipologia da ocorrência</strong><p>Sugerida a partir da classificação da RNC. Ajuste se necessário.</p></div>
              <div className="pam-typology">
                {PAM_TYPOLOGIES.map((option) => <label key={option}>
                  <input type="checkbox" checked={pam.typologies.includes(option)} onChange={(event) => setPam((current) => ({
                    ...current,
                    typologies: event.target.checked
                      ? PAM_TYPOLOGIES.filter((item) => item === option || current.typologies.includes(item))
                      : current.typologies.filter((item) => item !== option),
                  }))} />
                  {option}
                </label>)}
              </div>
            </section>
            <EditorField title="Descrição da ocorrência" value={pam.occurrenceDescription} onChange={(value) => setPam((current) => ({ ...current, occurrenceDescription: value }))} rows={6} required />
            <small className="template-note">Editar aqui altera somente este PAM; a descrição original da RNC não é modificada.</small>
            <EditorField title="Descrição da proposta de melhoria (com detalhamento das ações a serem tomadas)" value={pam.improvementProposal} onChange={(value) => setPam((current) => ({ ...current, improvementProposal: value }))} rows={14} required />
            <div className="pam-grid">
              <label className="editor-field"><span>Data</span><input type="date" value={pam.date} onChange={(event) => setPam((current) => ({ ...current, date: event.target.value }))} /></label>
              <label className="editor-field"><span>Responsável</span><input type="text" value={pam.responsible} onChange={(event) => setPam((current) => ({ ...current, responsible: event.target.value }))} placeholder="Responsável da área inspecionada" /></label>
              <label className="editor-field"><span>Prazo para o PAM</span><input type="text" value={pam.deadline} onChange={(event) => setPam((current) => ({ ...current, deadline: event.target.value }))} placeholder="Ex.: 15/11/2026 ou 30 dias" /></label>
            </div>
            {(() => {
              if (!plannerData || !rnc) return null;
              const items = buildItems({ commitments: plannerData.commitments, pams: plannerData.pams, rncs: plannerData.rncs, bands: plannerData.bands, today: plannerData.today });
              const currentPam = [...plannerData.pams].filter((pam) => pam.rncId === rnc.id && pam.source !== "EMAIL" && pam.status !== "SUBSTITUIDO").sort((a, b) => b.pamVersion - a.pamVersion)[0];
              if (!currentPam) {
                return <p className="template-note">Depois de salvar o PAM, os prazos e etapas identificados no texto aparecem aqui para confirmação e alimentam o Planner.</p>;
              }
              return <>
                <IdentifiedDeadlines
                  rncLabel={plannerRncLabel(rnc)}
                  pam={currentPam}
                  items={items.filter((item) => item.plannerPamId === currentPam.id)}
                  canAdjust={plannerData.canAdjust}
                  busy={plannerBusy}
                  onConfirm={() => void confirmPlannerPam(currentPam.id)}
                  onAdjust={() => { window.location.href = `/planner?rnc=${rnc.id}`; }}
                  onSentDate={() => { window.location.href = `/planner?rnc=${rnc.id}`; }}
                />
                <a className="template-note" href={`/planner?rnc=${rnc.id}`}>Abrir esta RNC no Planner</a>
              </>;
            })()}
          </> : <>
          <section className="automatic-template-fields">
            <div><span>RNC Nº</span><strong>{rnc.number}/{rnc.year}</strong></div>
            <div><span>Data da emissão da RNC</span><strong>{formatDate(rnc.receivedAt)}</strong><small>Data do e-mail oficial recebido</small></div>
            <div><span>Tipo da RNC</span><strong>{rnc.type}</strong></div>
            <div><span>Local / frente</span><strong>{rnc.workName}</strong></div>
            <div><span>Contrato</span><strong>{rnc.contract || "Não identificado no PDF"}</strong></div>
            <div><span>Responsável da área inspecionada</span><strong>{rnc.responseOwner || "Não identificado no PDF"}</strong></div>
            <div><span>Responsável fiscal pela inspeção</span><strong>{rnc.inspectionOwner || "Não identificado no PDF"}</strong></div>
          </section>
          <EditorField title="Análise da ocorrência" value={draft.analysis} onChange={(value) => update("analysis", value)} rows={8} required />
          <EditorField title="Medidas corretivas" value={draft.actionsTaken} onChange={(value) => update("actionsTaken", value)} rows={8} required />
          <EditorField title="Observações (se houver)" value={draft.observations} onChange={(value) => update("observations", value)} rows={5} />
          </>}
          <section className="template-fields">
            <div><strong>Registro fotográfico da ação corretiva</strong><p>{responseType === "PAM" ? "As fotografias e legendas ficam vinculadas a este PAM no sistema; o modelo FG 06 não possui área de fotos." : "As fotografias e legendas serão inseridas no modelo Word."}</p></div>
            <div className="photo-grid">
              {[0, 1, 2, 3].map((index) => {
                const legendField = `photoLegend${index + 1}` as keyof Draft;
                return <div key={index}>
                  <label><span>Foto {index + 1}</span><input type="file" accept="image/png,image/jpeg" onChange={(event) => setPhotos((current) => current.map((item, itemIndex) => itemIndex === index ? event.target.files?.[0] || null : item))} /></label>
                  <EditorField title={`Legenda ${index + 1}`} value={String(draft[legendField] || "")} onChange={(value) => update(legendField, value)} rows={2} />
                </div>;
              })}
            </div>
            <small className="template-note">Fotos: PNG ou JPEG, até 800 KB cada.</small>
          </section>
          <section className="word-document-panel">
            <div>
              <strong>Documento Word final</strong>
              <p>Anexe o `.docx` produzido e corrigido. Cada substituição cria uma versão preservada para conferência.</p>
            </div>
            <div className="word-upload">
              <input
                ref={documentInput}
                type="file"
                accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                onChange={(event) => uploadDocument(event.target.files?.[0])}
                disabled={busy}
              />
              <small>Formato .docx · máximo 3 MB</small>
            </div>
            <button className="button primary generate-word" type="button" onClick={generateDocument} disabled={busy}>
              {busy ? "Gerando…" : "Gerar e baixar Word preenchido"}
            </button>
            {responseType === "PAM" && <small className="template-note">O Word é gerado a partir do modelo oficial FG 06. As fotografias permanecem registradas no sistema e não fazem parte desse modelo.</small>}
            <div className="word-versions">
              {documents.length ? documents.map((document, index) => <div key={document.id} className={index === 0 ? "latest" : ""}>
                <span><strong>{index === 0 ? "Versão atual" : `Versão ${document.version}`}</strong><small>{document.fileName} · {(document.size / 1024).toFixed(0)} KB</small><small>{formatDate(document.createdAt)} · {document.uploadedBy}</small></span>
                <div className="word-actions">
                  <button className="button secondary" type="button" onClick={() => setPreviewDocument(document)}>Visualizar PDF</button>
                  <a className="button secondary link-button" href={`/api/rncs/${rnc.id}/response/document?document=${document.id}`}>Baixar Word</a>
                </div>
              </div>) : <p className="muted">Nenhum documento Word anexado. O documento é obrigatório para a aprovação.</p>}
            </div>
          </section>
          <EditorField title="Comentário interno — não será incluído no Word" value={draft.internalComment} onChange={(value) => update("internalComment", value)} rows={5} placeholder="Registre orientações, pendências ou comentários para o elaborador e o revisor." />
          <div className="save-bar"><span>Cada salvamento cria uma versão auditável.</span><button className="button primary" disabled={busy} onClick={saveDraft}>{busy ? "Salvando…" : "Salvar nova versão"}</button></div>
          <div className="agent-transfer">
            <div><strong>Usar o agente de RNC</strong><p>Copie os dados e documentos selecionados, abra o agente e utilize o conteúdo produzido para preencher os três campos técnicos acima.</p></div>
            <div className="form-actions">
              <button className="button secondary" type="button" onClick={copyContext}>Copiar contexto</button>
              <a className="button primary link-button" href="https://chatgpt.com/g/g-6a0c7aace1708191ade1c78cfc4f70e8-relatorios-tecnicos-assistente" target="_blank" rel="noreferrer">Abrir agente</a>
            </div>
          </div>
        </div>

        <aside className={`dossier-panel${activePanel ? " open" : ""}`}>
          <div className="dossier-panel-rail">
            <button type="button" className={activePanel === "documents" ? "active" : ""} title="Documentos do dossiê" onClick={() => togglePanel("documents")}><FileText size={18} /></button>
            <button type="button" className={activePanel === "versions" ? "active" : ""} title="Histórico da RNC" onClick={() => togglePanel("versions")}><History size={18} /></button>
            <button type="button" className={activePanel === "viewer" ? "active" : ""} title="Visualizar PDF" onClick={() => togglePanel("viewer")}><Eye size={18} /></button>
          </div>
          {activePanel && <div className="dossier-panel-content">
            {activePanel === "documents" && <>
              <h3>RNC {rnc.number}/{rnc.year}</h3>
              <p className="dossier-panel-description">{rnc.description}</p>
              <h4>Documentos do dossiê</h4>
              <div className="evidence-list">
                {attachments.length ? attachments.map((attachment) => {
                  const key = attachment.id || attachment.name;
                  const isPdf = /\.pdf$/i.test(attachment.name);
                  return <div className="evidence-item" key={key}>
                    <label>
                      <input type="checkbox" checked={selectedAttachments.includes(key)} onChange={(event) => setSelectedAttachments((current) => event.target.checked ? [...current, key] : current.filter((item) => item !== key))} />
                      <span><strong>{attachment.name}</strong><small>{attachment.needsOcr ? "Leitura indisponível" : attachment.extractionMethod === "PDF_TEXT" ? `${attachment.pageCount || "?"} página(s) · texto extraído` : "Anexo registrado"}</small></span>
                    </label>
                    {isPdf && attachment.eventId && <button type="button" className="button secondary" onClick={() => viewAttachment(attachment)}>Visualizar</button>}
                  </div>;
                }) : <p className="muted">Nenhum documento vinculado.</p>}
              </div>
              <h4>Respostas geradas (Word)</h4>
              <div className="evidence-list">
                {allDocuments.length ? allDocuments.map((document) => {
                  const type: ResponseType = document.responseType === "PAM" ? "PAM" : "TRATATIVA";
                  return <div className="evidence-item" key={document.id}>
                    <span><span className={`rt-badge rt-badge-${type}`}>{TIMELINE_BADGE[type]}</span><strong>{document.fileName}</strong><small>{responseLabel(type, document.version)} · {formatDate(document.createdAt)}</small></span>
                    <div className="word-actions">
                      <button type="button" className="button secondary" onClick={() => setPreviewDocument(document)}>Visualizar PDF</button>
                      <a className="button secondary link-button" href={`/api/rncs/${rnc.id}/response/document?document=${document.id}`}>Baixar Word</a>
                    </div>
                  </div>;
                }) : <p className="muted">Nenhum Word gerado ou anexado ainda.</p>}
              </div>
            </>}
            {activePanel === "versions" && <>
              <h3>Histórico da RNC</h3>
              <p className="dossier-panel-description">Todas as respostas, retornos, documentos e mudanças de status, em ordem cronológica. Nada é ocultado ao trocar de Tratativa para PAM.</p>
              <ol className="rt-list">
                {timeline.length ? timeline.map((item) => {
                  const clickable = Boolean(item.ref);
                  const content = <>
                    <span className="rt-meta"><span className={`rt-badge rt-badge-${item.kind}`}>{TIMELINE_BADGE[item.kind]}</span><small>{formatDate(item.at)}</small></span>
                    <strong>{item.title}</strong>
                    {item.detail && <small>{item.detail}</small>}
                  </>;
                  return <li key={item.key}>
                    {clickable
                      ? <button type="button" className="rt-item clickable" onClick={() => openTimelineItem(item)}>{content}</button>
                      : <div className="rt-item">{content}</div>}
                  </li>;
                }) : <p className="muted">Nenhum evento registrado.</p>}
              </ol>
            </>}
            {activePanel === "viewer" && <>
              <h3>Visualizar PDF</h3>
              {viewingAttachment
                ? <iframe
                    className="dossier-pdf-frame"
                    title={viewingAttachment.name}
                    src={`/api/rncs/${rnc.id}/dossier-attachment?eventId=${viewingAttachment.eventId}&attachmentId=${encodeURIComponent(viewingAttachment.id)}`}
                  />
                : <p className="muted">Selecione um documento na aba Documentos para visualizar.</p>}
            </>}
          </div>}
        </aside>
      </section>}
      {notice && <button className="toast" onClick={() => setNotice("")}>{notice}<span><X size={14} /></span></button>}
      {showConfirmDiscard && (
        <div className="modal-backdrop" onClick={() => {
          setShowConfirmDiscard(false);
          setPendingNavigation(null);
          setPendingRncId("");
          setPendingHref("");
          setPendingWorkId(null);
        }}>
          <div className="modal-dialog" onClick={(event) => event.stopPropagation()}>
            <h2>Descartar alterações?</h2>
            <p>Há mudanças não salvas. Se continuar, elas serão perdidas.</p>
            <div className="modal-actions">
              <button className="button secondary" onClick={() => {
                setShowConfirmDiscard(false);
                setPendingNavigation(null);
                setPendingRncId("");
                setPendingHref("");
                setPendingWorkId(null);
              }}>Cancelar</button>
              <button className="button primary" onClick={handleConfirmDiscard}>Descartar</button>
            </div>
          </div>
        </div>
      )}
      {viewingVersion && (() => {
        const view = describeVersion(viewingVersion);
        return <div className="modal-backdrop" onClick={() => setViewingVersion(null)}>
          <div className="modal-dialog version-viewer" role="dialog" aria-modal="true" aria-label={`${view.label} — somente leitura`} onClick={(event) => event.stopPropagation()}>
            <header>
              <span className={`rt-badge rt-badge-${view.type}`}>{TIMELINE_BADGE[view.type]}</span>
              <h2>{view.label}</h2>
              <small>Somente leitura · salvo em {new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(view.savedAt))}{viewingVersion.createdBy ? ` · ${viewingVersion.createdBy}` : ""} · Situação: {view.status}</small>
            </header>
            <dl>
              {view.fields.map((field) => <div key={field.label}><dt>{field.label}</dt><dd>{field.value || "—"}</dd></div>)}
            </dl>
            <p className="template-note">Fotografias não são guardadas por versão (apenas as legendas); elas constam nos documentos Word gerados, disponíveis na lista de documentos.</p>
            <div className="modal-actions">
              <button className="button secondary" onClick={() => setViewingVersion(null)}>Fechar</button>
              {view.type === responseType
                ? <button className="button primary" onClick={() => { restoreVersion(viewingVersion); setViewingVersion(null); }}>Carregar para edição</button>
                : <button className="button primary" onClick={() => { const target = view.type; setViewingVersion(null); requestSwitchType(target); }}>Abrir {view.type === "PAM" ? "PAM" : "Tratativa"}</button>}
            </div>
          </div>
        </div>;
      })()}
      {switchConfirmType && (
        <div className="modal-backdrop" onClick={() => setSwitchConfirmType(null)}>
          <div className="modal-dialog" onClick={(event) => event.stopPropagation()}>
            <h2>Criar nova resposta?</h2>
            <p>Já existe uma resposta em elaboração. Deseja criar uma nova resposta no formato {switchConfirmType === "PAM" ? "PAM" : "Tratativa"}? A versão existente será preservada no histórico.</p>
            <div className="modal-actions">
              <button className="button secondary" onClick={() => setSwitchConfirmType(null)}>Cancelar</button>
              <button className="button primary" onClick={() => { applyTypeSwitch(switchConfirmType, true); setSwitchConfirmType(null); }}>Criar nova resposta</button>
            </div>
          </div>
        </div>
      )}
      {previewDocument && rnc && <div className="document-preview-backdrop" role="presentation" onClick={() => setPreviewDocument(null)}>
        <section className="document-preview-modal" role="dialog" aria-modal="true" aria-label={`Visualização de ${previewDocument.fileName}`} onClick={(event) => event.stopPropagation()}>
          <header>
            <div><strong>{previewDocument.fileName}</strong><small>Versão {previewDocument.version} · visualização para conferência</small></div>
            <div className="word-actions">
              <label className="preview-zoom">Zoom
                <select value={previewZoom} onChange={(event) => setPreviewZoom(Number(event.target.value))}>
                  <option value={50}>50% · visão geral</option><option value={60}>60%</option><option value={70}>70%</option><option value={80}>80%</option>
                  <option value={90}>90%</option><option value={100}>100% · leitura</option><option value={110}>110%</option><option value={125}>125%</option>
                </select>
              </label>
              <a className="button secondary link-button" href={`/api/rncs/${rnc.id}/response/document?document=${previewDocument.id}`}>Baixar Word</a>
              <button className="button primary" type="button" onClick={() => setPreviewDocument(null)}>Fechar</button>
            </div>
          </header>
          {previewing && <div className="document-preview-loading">Convertendo para PDF…</div>}
          <div className="document-preview-content">
            {previewPdfUrl && (
              <iframe
                src={previewPdfUrl}
                title={`Pré-visualização em PDF de ${previewDocument.fileName}`}
                className="rnc-pdf-preview"
                style={{ zoom: `${previewZoom}%` }}
              />
            )}
          </div>
          <footer>A visualização pode apresentar pequenas diferenças em relação ao Microsoft Word. O arquivo original não é alterado.</footer>
        </section>
      </div>}
      </main>
    </div>
  );
}

function EditorField({ title, value, onChange, rows = 6, required = false, placeholder = "" }: {
  title: string; value: string; onChange: (value: string) => void; rows?: number;
  required?: boolean; placeholder?: string;
}) {
  return <label className="editor-field"><span>{title}{required ? " *" : ""}</span><textarea value={value} onChange={(event) => onChange(event.target.value)} rows={rows} required={required} placeholder={placeholder} /></label>;
}
