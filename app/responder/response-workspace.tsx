"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { normalizeDocxForPreview } from "../../lib/docx-preview-normalizer";

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
  attachmentMetadata: string | null;
};
type Attachment = {
  id: string; name: string; extractedText?: string; extractionMethod?: string;
  pageCount?: number; needsOcr?: boolean;
};
type Draft = {
  directive: string; analysis: string; actionsTaken: string; technicalResponse: string;
  evidence: string; conclusion: string; agentResponse: string; emailBody: string;
  locationFront: string; contract: string; observations: string;
  photoLegend1: string; photoLegend2: string; photoLegend3: string; photoLegend4: string;
  internalComment: string; selectedAttachments: string; status: string; updatedAt?: string;
  updatedBy?: string;
};
type Version = { id: number; version: number; snapshot: string; createdAt: string; createdBy?: string };
type WordDocument = {
  id: number; version: number; fileName: string; size: number; uploadedBy: string; createdAt: string;
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
        .map((attachment) => ({ ...attachment, eventSubject: email.subject || email.eventType }));
    } catch {
      return [];
    }
  });
  return [...new Map(attachments.map((item) => [item.id || item.name, item])).values()];
}

function fitPreviewTables(container: HTMLDivElement) {
  container.querySelectorAll<HTMLElement>("section.rnc-docx-preview").forEach((page) => {
    const pageStyle = window.getComputedStyle(page);
    const pageRect = page.getBoundingClientRect();
    const renderedScale = page.clientWidth ? pageRect.width / page.clientWidth : 1;
    const contentRight = pageRect.right
      - Number.parseFloat(pageStyle.paddingRight) * renderedScale;

    page.querySelectorAll<HTMLTableElement>("table").forEach((table) => {
      table.style.removeProperty("transform");
      table.style.removeProperty("transform-origin");
      const tableRect = table.getBoundingClientRect();
      if (!tableRect.width || tableRect.right <= contentRight + 1) return;

      const visibleWidth = Math.max(1, contentRight - tableRect.left);
      const ratio = Math.min(1, visibleWidth / tableRect.width);
      table.style.transformOrigin = "left top";
      table.style.transform = `scaleX(${ratio})`;
    });
  });
}

export function ResponseWorkspace() {
  const [rncs, setRncs] = useState<RncListItem[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [rnc, setRnc] = useState<RncDetail | null>(null);
  const [emails, setEmails] = useState<EmailEvent[]>([]);
  const [versions, setVersions] = useState<Version[]>([]);
  const [documents, setDocuments] = useState<WordDocument[]>([]);
  const [photos, setPhotos] = useState<Array<File | null>>([null, null, null, null]);
  const [previewDocument, setPreviewDocument] = useState<WordDocument | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [previewZoom, setPreviewZoom] = useState(100);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [selectedAttachments, setSelectedAttachments] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [accessUser, setAccessUser] = useState<AccessUser | null>(null);
  const [initialDraftSnapshot, setInitialDraftSnapshot] = useState<Draft>(emptyDraft);
  const [initialPhotosSnapshot, setInitialPhotosSnapshot] = useState<Array<File | null>>([null, null, null, null]);
  const [initialSelectedAttachmentsSnapshot, setInitialSelectedAttachmentsSnapshot] = useState<string[]>([]);
  const [showConfirmDiscard, setShowConfirmDiscard] = useState(false);
  const [pendingNavigation, setPendingNavigation] = useState<"rnc" | "panel" | null>(null);
  const [pendingRncId, setPendingRncId] = useState("");
  const documentInput = useRef<HTMLInputElement>(null);
  const previewContainer = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!previewDocument) return;
    setPreviewZoom(window.innerWidth >= 900 ? 100 : window.innerWidth >= 650 ? 80 : 60);
  }, [previewDocument]);

  useEffect(() => {
    fetch("/api/rncs")
      .then((response) => response.json())
      .then((data) => {
        const available = (data.rncs || []).filter((item: RncListItem) => item.status !== "Aprovada");
        setRncs(available);
        const requested = new URLSearchParams(window.location.search).get("rnc");
        const initial = available.some((item: RncListItem) => String(item.id) === requested)
          ? requested
          : available[0] ? String(available[0].id) : "";
        setSelectedId(initial || "");
      })
      .catch(() => setNotice("Não foi possível carregar as RNCs."));
  }, []);

  useEffect(() => {
    if (!selectedId) return;
    queueMicrotask(() => setBusy(true));
    window.history.replaceState({}, "", `/responder?rnc=${selectedId}`);
    Promise.all([
      fetch(`/api/rncs/${selectedId}/response`).then(async (response) => ({ response, data: await response.json() })),
      fetch(`/api/rncs/${selectedId}/response/document`).then((response) => response.json()),
    ])
      .then(([{ response, data }, documentData]) => {
        if (!response.ok) throw new Error(data.error || "Não foi possível abrir a RNC.");
        setRnc(data.rnc);
        setEmails(data.emails || []);
        setVersions(data.versions || []);
        setAccessUser(data.user || null);
        setDocuments(documentData.documents || []);
        setPhotos([null, null, null, null]);
        const loaded = data.draft || emptyDraft;
        const draftWithDefaults = { ...emptyDraft, ...loaded };
        setDraft(draftWithDefaults);
        setInitialDraftSnapshot(draftWithDefaults);
        setInitialPhotosSnapshot([null, null, null, null]);
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
  }, [selectedId]);

  const attachments = useMemo(() => attachmentsFromEmails(emails), [emails]);

  const hasUnsavedChanges = useMemo(() => {
    if (JSON.stringify(initialDraftSnapshot) === JSON.stringify(emptyDraft)) return false;
    const draftChanged = JSON.stringify(draft) !== JSON.stringify(initialDraftSnapshot);
    const attachmentsChanged = JSON.stringify(selectedAttachments) !== JSON.stringify(initialSelectedAttachmentsSnapshot);
    const photosChanged = photos.some((photo, i) => {
      const initialPhoto = initialPhotosSnapshot[i];
      return (photo === null) !== (initialPhoto === null) || (photo !== null && initialPhoto !== null && photo.name !== initialPhoto.name);
    });
    return draftChanged || attachmentsChanged || photosChanged;
  }, [draft, selectedAttachments, photos, initialDraftSnapshot, initialSelectedAttachmentsSnapshot, initialPhotosSnapshot]);

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
    if (!rnc || !previewDocument || !previewContainer.current) return;
    let active = true;
    const container = previewContainer.current;
    container.replaceChildren();
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
        const [previewBuffer, { renderAsync }] = await Promise.all([
          normalizeDocxForPreview(buffer),
          import("docx-preview"),
        ]);
        if (!active) return;
        await renderAsync(previewBuffer, container, undefined, {
          className: "rnc-docx-preview",
          inWrapper: true,
          ignoreWidth: false,
          ignoreHeight: false,
          ignoreFonts: false,
          breakPages: true,
          useBase64URL: true,
        });
        await document.fonts.ready;
        await new Promise<void>((resolve) => window.requestAnimationFrame(() =>
          window.requestAnimationFrame(() => resolve()),
        ));
        if (active) {
          fitPreviewTables(container);
          window.setTimeout(() => {
            if (active) fitPreviewTables(container);
          }, 250);
        }
      })
      .catch((error) => {
        if (active) setNotice(error instanceof Error ? error.message : "Não foi possível abrir o documento.");
      })
      .finally(() => {
        if (active) setPreviewing(false);
      });
    return () => { active = false; };
  }, [previewDocument, rnc]);

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
    return [
      "ELABORAÇÃO DE RESPOSTA TÉCNICA — RNC",
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
      `Análise da ocorrência: ${draft.analysis || "Ainda não preenchida"}`,
      `Medidas corretivas: ${draft.actionsTaken || "Ainda não preenchidas"}`,
      `Observações: ${draft.observations || "Sem observações"}`,
      selected.length ? `Documentos selecionados:\n${attachmentText}` : "Documentos selecionados: nenhum",
      "Elabore uma minuta técnica para revisão, sem enviar e-mail e sem inventar informações ausentes.",
    ].join("\n\n");
  }

  async function copyContext() {
    await navigator.clipboard.writeText(contextForAgent());
    setNotice("Contexto copiado. Abra o agente e cole as informações.");
  }

  function handleConfirmDiscard() {
    if (pendingNavigation === "rnc" && pendingRncId) {
      setSelectedId(pendingRncId);
    } else if (pendingNavigation === "panel") {
      window.location.href = "/";
    }
    setShowConfirmDiscard(false);
    setPendingNavigation(null);
    setPendingRncId("");
  }

  async function saveDraft() {
    if (!rnc) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/rncs/${rnc.id}/response`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...draft, selectedAttachments }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Não foi possível salvar.");
      setNotice(`Versão ${data.version} salva.`);
      const refreshed = await fetch(`/api/rncs/${rnc.id}/response`).then((item) => item.json());
      setVersions(refreshed.versions || []);
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
      const response = await fetch(`/api/rncs/${rnc.id}/response/document`, {
        method: "POST",
        body: form,
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Não foi possível anexar o documento.");
      const refreshed = await fetch(`/api/rncs/${rnc.id}/response/document`).then((item) => item.json());
      setDocuments(refreshed.documents || []);
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
      form.set("draft", JSON.stringify(draft));
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
      link.download = `Tratativa_RNC_${rnc.number}_${rnc.year}.docx`;
      link.click();
      URL.revokeObjectURL(link.href);

      const saveResponse = await fetch(`/api/rncs/${rnc.id}/response`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...draft, selectedAttachments }),
      });
      const saveData = await saveResponse.json();
      if (!saveResponse.ok) throw new Error(saveData.error || "O Word foi gerado, mas os campos não foram salvos.");
      const [documentData, responseData] = await Promise.all([
        fetch(`/api/rncs/${rnc.id}/response/document`).then((item) => item.json()),
        fetch(`/api/rncs/${rnc.id}/response`).then((item) => item.json()),
      ]);
      setDocuments(documentData.documents || []);
      setVersions(responseData.versions || []);
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
      setNotice(`Versão ${version.version} carregada para edição. Salve para registrar uma nova versão.`);
    } catch {
      setNotice("Não foi possível carregar esta versão.");
    }
  }

  return (
    <main>
      <header className="topbar">
        <Link className="brand brand-link" href="/">
          <Image className="brand-mark" src="/favicon-rnc.png" alt="RNC" width={39} height={39} priority />
          <div><strong>Controle de RNC</strong><small>Área de elaboração de respostas</small></div>
        </Link>
        <div className="header-actions">{accessUser && <span className="user-chip"><strong>{accessUser.name}</strong><small>{accessUser.role === "drafter" ? "Elaborador" : accessUser.role === "admin" ? "Administradora" : "Revisor/Aprovador"}</small></span>}<button className="button secondary link-button" onClick={() => {
          if (hasUnsavedChanges) {
            setPendingNavigation("panel");
            setShowConfirmDiscard(true);
          } else {
            window.location.href = "/";
          }
        }}>← Voltar ao painel</button><a className="logout-link" href="/api/auth/logout">Sair</a></div>
      </header>

      <section className="response-page-heading">
        <div><p className="eyebrow">Elaboração assistida</p><h1>Responder RNC</h1><p>Organize a tratativa, utilize seu agente e mantenha as versões na mesma página.</p></div>
        <label>Selecionar RNC
          <select value={selectedId} onChange={(event) => {
            if (hasUnsavedChanges) {
              setPendingNavigation("rnc");
              setShowConfirmDiscard(true);
              setPendingRncId(event.target.value);
            } else {
              setSelectedId(event.target.value);
            }
          }}>
            {rncs.map((item) => <option key={item.id} value={item.id}>RNC {item.number}/{item.year} · {item.status}</option>)}
          </select>
        </label>
      </section>

      {!rnc && <section className="response-empty">{busy ? "Carregando RNC…" : "Não há RNC disponível para resposta."}</section>}
      {rnc && <section className="response-workspace">
        <aside className="response-dossier">
          <span className={`status status-${rnc.status.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replaceAll(" ", "-")}`}>{rnc.status}</span>
          <h2>RNC {rnc.number}/{rnc.year}</h2>
          <p>{rnc.description}</p>
          <dl>
            <div><dt>Obra</dt><dd>{rnc.workName}</dd></div>
            <div><dt>Tipo</dt><dd>{rnc.type}</dd></div>
            <div><dt>Recebimento</dt><dd>{formatDate(rnc.receivedAt)}</dd></div>
            <div><dt>Prazo</dt><dd>{formatDate(rnc.dueAt)}</dd></div>
            <div><dt>Responsável da área inspecionada</dt><dd>{rnc.responseOwner || "Não identificado"}</dd></div>
            <div><dt>Responsável fiscal pela inspeção</dt><dd>{rnc.inspectionOwner || "Não identificado"}</dd></div>
            <div><dt>Contrato</dt><dd>{rnc.contract || "Não identificado"}</dd></div>
            {rnc.analysisOwner && <div><dt>Resp. pela análise</dt><dd>{rnc.analysisOwner}</dd></div>}
            <div><dt>Envio anterior</dt><dd>{formatDate(rnc.sentAt)}</dd></div>
          </dl>
          <h3>Documentos do dossiê</h3>
          <div className="evidence-list">
            {attachments.length ? attachments.map((attachment) => {
              const key = attachment.id || attachment.name;
              return <label key={key}>
                <input type="checkbox" checked={selectedAttachments.includes(key)} onChange={(event) => setSelectedAttachments((current) => event.target.checked ? [...current, key] : current.filter((item) => item !== key))} />
                <span><strong>{attachment.name}</strong><small>{attachment.needsOcr ? "Leitura indisponível" : attachment.extractionMethod === "PDF_TEXT" ? `${attachment.pageCount || "?"} página(s) · texto extraído` : "Anexo registrado"}</small></span>
              </label>;
            }) : <p className="muted">Nenhum documento vinculado.</p>}
          </div>
        </aside>

        <div className="response-editor">
          {hasUnsavedChanges && (
            <div className="unsaved-warning">
              <span>⚠️ Há alterações não salvas. Clique em "Salvar nova versão" para registrar.</span>
            </div>
          )}
          <div className="editor-toolbar">
            <label>Situação do documento
              <select value={draft.status} onChange={(event) => update("status", event.target.value)}>
                <option>Rascunho</option><option>Em revisão</option>{accessUser?.role !== "drafter" && <option>Documento aprovado</option>}
              </select>
            </label>
            <span>{draft.updatedAt ? `Último salvamento: ${formatDate(draft.updatedAt)}${draft.updatedBy ? ` · ${draft.updatedBy}` : ""}` : "Ainda não salvo"}</span>
          </div>
          <section className="automatic-template-fields">
            <div><span>RNC Nº</span><strong>{rnc.number}/{rnc.year}</strong></div>
            <div><span>Data da emissão da RNC</span><strong>{formatDate(rnc.receivedAt)}</strong><small>Data do e-mail oficial recebido</small></div>
            <div><span>Data da emissão da tratativa</span><strong>{formatDate(new Date().toISOString())}</strong><small>Data de hoje</small></div>
            <div><span>Local / frente</span><strong>{rnc.workName}</strong></div>
            <div><span>Contrato</span><strong>{rnc.contract || "Não identificado no PDF"}</strong></div>
            <div><span>Responsável da área inspecionada</span><strong>{rnc.responseOwner || "Não identificado no PDF"}</strong></div>
            <div><span>Responsável fiscal pela inspeção</span><strong>{rnc.inspectionOwner || "Não identificado no PDF"}</strong></div>
          </section>
          <EditorField title="Análise da ocorrência" value={draft.analysis} onChange={(value) => update("analysis", value)} rows={8} required />
          <EditorField title="Medidas corretivas" value={draft.actionsTaken} onChange={(value) => update("actionsTaken", value)} rows={8} required />
          <EditorField title="Observações (se houver)" value={draft.observations} onChange={(value) => update("observations", value)} rows={5} />
          <section className="template-fields">
            <div><strong>Registro fotográfico da ação corretiva</strong><p>As fotografias e legendas serão inseridas no modelo Word.</p></div>
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
            <div className="word-versions">
              {documents.length ? documents.map((document, index) => <div key={document.id} className={index === 0 ? "latest" : ""}>
                <span><strong>{index === 0 ? "Versão atual" : `Versão ${document.version}`}</strong><small>{document.fileName} · {(document.size / 1024).toFixed(0)} KB</small><small>{formatDate(document.createdAt)} · {document.uploadedBy}</small></span>
                <div className="word-actions">
                  <button className="button secondary" type="button" onClick={() => setPreviewDocument(document)}>Visualizar Word</button>
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

        <aside className="version-panel">
          <h3>Histórico de versões</h3>
          {versions.length ? versions.map((version) => <button key={version.id} onClick={() => restoreVersion(version)}>
            <strong>Versão {version.version}</strong><small>{new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(version.createdAt))}</small>{version.createdBy && <small>{version.createdBy}</small>}
          </button>) : <p className="muted">Nenhuma versão salva.</p>}
        </aside>
      </section>}
      {notice && <button className="toast" onClick={() => setNotice("")}>{notice}<span>×</span></button>}
      {showConfirmDiscard && (
        <div className="modal-backdrop" onClick={() => {
          setShowConfirmDiscard(false);
          setPendingNavigation(null);
          setPendingRncId("");
        }}>
          <div className="modal-dialog" onClick={(event) => event.stopPropagation()}>
            <h2>Descartar alterações?</h2>
            <p>Há mudanças não salvas. Se continuar, elas serão perdidas.</p>
            <div className="modal-actions">
              <button className="button secondary" onClick={() => {
                setShowConfirmDiscard(false);
                setPendingNavigation(null);
                setPendingRncId("");
              }}>Cancelar</button>
              <button className="button primary" onClick={handleConfirmDiscard}>Descartar</button>
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
          {previewing && <div className="document-preview-loading">Preparando visualização do Word…</div>}
          <div className="document-preview-content"><div ref={previewContainer} style={{ zoom: `${previewZoom}%` }} /></div>
          <footer>A visualização pode apresentar pequenas diferenças em relação ao Microsoft Word. O arquivo original não é alterado.</footer>
        </section>
      </div>}
    </main>
  );
}

function EditorField({ title, value, onChange, rows = 6, required = false, placeholder = "" }: {
  title: string; value: string; onChange: (value: string) => void; rows?: number;
  required?: boolean; placeholder?: string;
}) {
  return <label className="editor-field"><span>{title}{required ? " *" : ""}</span><textarea value={value} onChange={(event) => onChange(event.target.value)} rows={rows} required={required} placeholder={placeholder} /></label>;
}
