"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

type RncListItem = {
  id: number; number: string; year: number; description: string; status: string;
};
type RncDetail = RncListItem & {
  workName: string; type: string; receivedAt: string | null; dueAt: string | null;
  sentAt: string | null; returnedAt: string | null; responseOwner: string; analysisOwner: string;
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
  selectedAttachments: string; status: string; updatedAt?: string;
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

export function ResponseWorkspace() {
  const [rncs, setRncs] = useState<RncListItem[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [rnc, setRnc] = useState<RncDetail | null>(null);
  const [emails, setEmails] = useState<EmailEvent[]>([]);
  const [versions, setVersions] = useState<Version[]>([]);
  const [documents, setDocuments] = useState<WordDocument[]>([]);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [selectedAttachments, setSelectedAttachments] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [accessUser, setAccessUser] = useState<AccessUser | null>(null);
  const documentInput = useRef<HTMLInputElement>(null);

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
        const loaded = data.draft || emptyDraft;
        setDraft({ ...emptyDraft, ...loaded });
        try { setSelectedAttachments(JSON.parse(loaded.selectedAttachments || "[]")); }
        catch { setSelectedAttachments([]); }
      })
      .catch((error) => setNotice(error instanceof Error ? error.message : "Falha ao abrir a RNC."))
      .finally(() => setBusy(false));
  }, [selectedId]);

  const attachments = useMemo(() => attachmentsFromEmails(emails), [emails]);

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
      `Status atual: ${rnc.status}`,
      `Diretriz: ${draft.directive || "Não informada"}`,
      `Análise preliminar: ${draft.analysis || "Não informada"}`,
      `Providências executadas: ${draft.actionsTaken || "Não informadas"}`,
      `Evidências: ${draft.evidence || "Não informadas"}`,
      selected.length ? `Documentos selecionados:\n${attachmentText}` : "Documentos selecionados: nenhum",
      "Elabore uma minuta técnica para revisão, sem enviar e-mail e sem inventar informações ausentes.",
    ].join("\n\n");
  }

  async function copyContext() {
    if (!draft.directive.trim()) {
      setNotice("Preencha a diretriz antes de copiar as informações.");
      return;
    }
    await navigator.clipboard.writeText(contextForAgent());
    setNotice("Contexto copiado. Abra o agente e cole as informações.");
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
      setDraft((current) => ({ ...current, updatedAt: data.draft.updatedAt }));
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

  function restoreVersion(version: Version) {
    try {
      const snapshot = JSON.parse(version.snapshot) as Partial<Draft> & { selectedAttachments?: string };
      setDraft({ ...emptyDraft, ...snapshot });
      setSelectedAttachments(JSON.parse(snapshot.selectedAttachments || "[]"));
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
        <div className="header-actions">{accessUser && <span className="user-chip"><strong>{accessUser.name}</strong><small>{accessUser.role === "drafter" ? "Elaborador" : accessUser.role === "admin" ? "Administradora" : "Revisor/Aprovador"}</small></span>}<Link className="button secondary link-button" href="/">← Voltar ao painel</Link><a className="logout-link" href="/api/auth/logout">Sair</a></div>
      </header>

      <section className="response-page-heading">
        <div><p className="eyebrow">Elaboração assistida</p><h1>Responder RNC</h1><p>Organize a tratativa, utilize seu agente e mantenha as versões na mesma página.</p></div>
        <label>Selecionar RNC
          <select value={selectedId} onChange={(event) => setSelectedId(event.target.value)}>
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
            <div><dt>Resp. pela resposta</dt><dd>{rnc.responseOwner || "Não identificado"}</dd></div>
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
          <div className="editor-toolbar">
            <label>Situação do documento
              <select value={draft.status} onChange={(event) => update("status", event.target.value)}>
                <option>Rascunho</option><option>Em revisão</option>{accessUser?.role !== "drafter" && <option>Documento aprovado</option>}
              </select>
            </label>
            <span>{draft.updatedAt ? `Último salvamento: ${formatDate(draft.updatedAt)}${draft.updatedBy ? ` · ${draft.updatedBy}` : ""}` : "Ainda não salvo"}</span>
          </div>
          <EditorField title="Diretriz para elaboração da resposta" value={draft.directive} onChange={(value) => update("directive", value)} required placeholder="Informe o que foi executado, documentos e evidências, justificativas e o posicionamento a adotar." />
          <div className="editor-grid">
            <EditorField title="Análise da não conformidade" value={draft.analysis} onChange={(value) => update("analysis", value)} />
            <EditorField title="Providências executadas" value={draft.actionsTaken} onChange={(value) => update("actionsTaken", value)} />
            <EditorField title="Evidências" value={draft.evidence} onChange={(value) => update("evidence", value)} />
            <EditorField title="Conclusão" value={draft.conclusion} onChange={(value) => update("conclusion", value)} />
          </div>
          <div className="agent-transfer">
            <div><strong>Usar o agente de RNC</strong><p>Copie o contexto, abra o agente e cole a resposta produzida no campo abaixo.</p></div>
            <div className="form-actions">
              <button className="button secondary" type="button" onClick={copyContext}>Copiar contexto</button>
              <a className="button primary link-button" href="https://chatgpt.com/g/g-6a0c7aace1708191ade1c78cfc4f70e8-relatorios-tecnicos-assistente" target="_blank" rel="noreferrer">Abrir agente</a>
            </div>
          </div>
          <EditorField title="Resposta produzida pelo agente" value={draft.agentResponse} onChange={(value) => update("agentResponse", value)} rows={12} placeholder="Cole aqui a resposta gerada para revisar e manter no histórico." />
          <EditorField title="Resposta técnica final" value={draft.technicalResponse} onChange={(value) => update("technicalResponse", value)} rows={10} />
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
            <div className="word-versions">
              {documents.length ? documents.map((document, index) => <div key={document.id} className={index === 0 ? "latest" : ""}>
                <span><strong>{index === 0 ? "Versão atual" : `Versão ${document.version}`}</strong><small>{document.fileName} · {(document.size / 1024).toFixed(0)} KB</small><small>{formatDate(document.createdAt)} · {document.uploadedBy}</small></span>
                <a className="button secondary link-button" href={`/api/rncs/${rnc.id}/response/document?document=${document.id}`}>Baixar Word</a>
              </div>) : <p className="muted">Nenhum documento Word anexado. O documento é obrigatório para a aprovação.</p>}
            </div>
          </section>
          <EditorField title="Texto sugerido para o e-mail" value={draft.emailBody} onChange={(value) => update("emailBody", value)} rows={5} placeholder={`Prezados,\n\nEncaminhamos a resposta à RNC nº ${rnc.number}/${rnc.year} para análise.`} />
          <div className="save-bar"><span>Cada salvamento cria uma versão auditável.</span><button className="button primary" disabled={busy} onClick={saveDraft}>{busy ? "Salvando…" : "Salvar nova versão"}</button></div>
        </div>

        <aside className="version-panel">
          <h3>Histórico de versões</h3>
          {versions.length ? versions.map((version) => <button key={version.id} onClick={() => restoreVersion(version)}>
            <strong>Versão {version.version}</strong><small>{new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(version.createdAt))}</small>{version.createdBy && <small>{version.createdBy}</small>}
          </button>) : <p className="muted">Nenhuma versão salva.</p>}
        </aside>
      </section>}
      {notice && <button className="toast" onClick={() => setNotice("")}>{notice}<span>×</span></button>}
    </main>
  );
}

function EditorField({ title, value, onChange, rows = 6, required = false, placeholder = "" }: {
  title: string; value: string; onChange: (value: string) => void; rows?: number;
  required?: boolean; placeholder?: string;
}) {
  return <label className="editor-field"><span>{title}{required ? " *" : ""}</span><textarea value={value} onChange={(event) => onChange(event.target.value)} rows={rows} required={required} placeholder={placeholder} /></label>;
}
