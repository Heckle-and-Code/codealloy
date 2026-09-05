(function() {
	const vscode = acquireVsCodeApi();

	const modelNameEl = document.getElementById('modelName');
	const statusDotEl = document.getElementById('statusDot');
	const modelBadgeEl = document.getElementById('modelBadge');
	const clearBtn = document.getElementById('clearBtn');
	const promptInput = document.getElementById('promptInput');
	const sendBtn = document.getElementById('sendBtn');
	const stopBtn = document.getElementById('stopBtn');
	const messagesContainer = document.getElementById('messagesContainer');
	const emptyState = document.getElementById('emptyState');
	const emptyFlame = document.getElementById('emptyFlame');
	const emptyTitle = document.getElementById('emptyTitle');
	const emptyDesc = document.getElementById('emptyDesc');
	const emptyActions = document.getElementById('emptyActions');
	const autonomyDial = document.getElementById('autonomyDial');
	const timelineBtn = document.getElementById('timelineBtn');
	const timelineDrawer = document.getElementById('timelineDrawer');
	const timelineCloseBtn = document.getElementById('timelineCloseBtn');
	const timelineList = document.getElementById('timelineList');

	let isStreaming = false;
	let currentAssistantTurnId = null;
	let pendingAssistantTurnEl = null;

	window.onerror = function(msg, url, line, col, error) {
		try {
			vscode.postMessage({ type: 'logError', error: String(msg) + ' (' + line + ':' + col + ')' });
		} catch (e) {}
	};

	// Notify extension that webview is loaded
	vscode.postMessage({ type: 'ready' });

	// Autonomy Dial Event Handlers
	if (autonomyDial) {
		autonomyDial.querySelectorAll('.autonomy-dial-btn').forEach(function(btn) {
			btn.addEventListener('click', function() {
				const level = btn.getAttribute('data-level');
				autonomyDial.querySelectorAll('.autonomy-dial-btn').forEach(function(b) {
					b.classList.remove('active');
				});
				btn.classList.add('active');
				vscode.postMessage({ type: 'setAutonomy', level: level });
			});
		});
	}

	// Timeline Drawer Handlers (US-3.3)
	if (timelineBtn && timelineDrawer) {
		timelineBtn.addEventListener('click', function() {
			const isVisible = timelineDrawer.style.display !== 'none';
			timelineDrawer.style.display = isVisible ? 'none' : 'flex';
			if (!isVisible) {
				vscode.postMessage({ type: 'getTimeTravelTimeline' });
			}
		});
	}

	if (timelineCloseBtn && timelineDrawer) {
		timelineCloseBtn.addEventListener('click', function() {
			timelineDrawer.style.display = 'none';
		});
	}

	window.undoTurn = function(assistantMsgId, commitHash) {
		vscode.postMessage({
			type: 'rollbackTurn',
			assistantMsgId: assistantMsgId,
			commitHash: commitHash
		});
	};

	window.revertToTimelinePoint = function(commitHash) {
		vscode.postMessage({
			type: 'rollbackToTimelinePoint',
			commitHash: commitHash
		});
	};

	window.triggerSelectModel = function() {
		vscode.postMessage({ type: 'selectModel' });
	};

	window.sendQuickPrompt = function(promptText) {
		if (isStreaming) return;
		executeSend(promptText);
	};

	window.approveAction = function(actionId) {
		const card = document.getElementById('approval-' + actionId);
		if (card) {
			card.classList.add('resolved');
			card.classList.remove('active-approval');
			const actionsEl = card.querySelector('.approval-actions');
			if (actionsEl) {
				actionsEl.innerHTML = '<span style="color: #4EBD79; font-weight: 600; font-size: 11px;">✓ Action Approved</span>';
			}
		}
		vscode.postMessage({ type: 'actionApproved', actionId: actionId });
	};

	window.rejectAction = function(actionId) {
		const card = document.getElementById('approval-' + actionId);
		if (card) {
			card.classList.add('resolved');
			card.classList.remove('active-approval');
			const actionsEl = card.querySelector('.approval-actions');
			if (actionsEl) {
				actionsEl.innerHTML = '<span style="color: #E06C75; font-weight: 600; font-size: 11px;">✗ Action Rejected</span>';
			}
		}
		vscode.postMessage({ type: 'actionRejected', actionId: actionId, reason: 'Rejected by user in L2 Supervised mode' });
	};

	// Keyboard shortcut handling: Enter to Approve, Esc to Reject active L2 card
	document.addEventListener('keydown', function(e) {
		const activeCard = document.querySelector('.action-approval-card.active-approval:not(.resolved)');
		if (!activeCard) return;

		const actionId = activeCard.getAttribute('data-action-id');
		if (!actionId) return;

		if (e.key === 'Escape') {
			e.preventDefault();
			e.stopPropagation();
			window.rejectAction(actionId);
		} else if (e.key === 'Enter' && document.activeElement !== promptInput) {
			e.preventDefault();
			e.stopPropagation();
			window.approveAction(actionId);
		}
	});

	if (modelBadgeEl) {
		modelBadgeEl.addEventListener('click', function() {
			window.triggerSelectModel();
		});
	}

	if (clearBtn) {
		clearBtn.addEventListener('click', function() {
			vscode.postMessage({ type: 'clearChat' });
		});
	}

	if (stopBtn) {
		stopBtn.addEventListener('click', function() {
			vscode.postMessage({ type: 'abortStream' });
			endStreamUI();
		});
	}

	function executeSend(text) {
		text = (text || '').trim();
		if (!text || isStreaming) return;

		if (promptInput) {
			promptInput.value = '';
			promptInput.style.height = 'auto';
		}

		// 1. Hide empty state immediately
		if (emptyState) {
			emptyState.style.display = 'none';
		}

		// 2. Optimistically render User bubble immediately
		const userDiv = document.createElement('div');
		userDiv.className = 'message-bubble user';
		userDiv.innerHTML = '<div class="message-content">' + renderMarkdown(text) + '</div>';
		messagesContainer.appendChild(userDiv);

		// 3. Optimistically render Assistant thinking banner immediately
		const tempTurnId = 'asst-turn-' + Date.now();
		currentAssistantTurnId = tempTurnId;

		const asstDiv = document.createElement('div');
		asstDiv.className = 'message-bubble assistant';
		asstDiv.id = tempTurnId;
		asstDiv._rawText = '';
		asstDiv.innerHTML = '<div class="message-header">CodeAlloy Agent &bull; Local Engine</div>' +
			'<div class="message-content">' +
				'<div class="forging-banner"><span class="flame-icon">🔥</span> <span>Thinking & forging response with local model...</span></div>' +
			'</div>';
		messagesContainer.appendChild(asstDiv);
		pendingAssistantTurnEl = asstDiv;

		setStreamingUI(true);
		messagesContainer.scrollTop = messagesContainer.scrollHeight;

		vscode.postMessage({ type: 'sendMessage', prompt: text, assistantMsgId: tempTurnId });
	}

	function sendCurrentPrompt() {
		if (!promptInput) return;
		executeSend(promptInput.value);
	}
	window.sendCurrentPrompt = sendCurrentPrompt;

	if (sendBtn) {
		sendBtn.addEventListener('click', sendCurrentPrompt);
	}

	if (promptInput) {
		promptInput.addEventListener('keydown', function(e) {
			if (e.key === 'Enter' && !e.shiftKey) {
				e.preventDefault();
				sendCurrentPrompt();
			}
		});

		promptInput.addEventListener('input', function() {
			promptInput.style.height = 'auto';
			promptInput.style.height = Math.min(promptInput.scrollHeight, 140) + 'px';
		});
	}

	function setStreamingUI(streaming) {
		isStreaming = streaming;
		if (streaming) {
			if (sendBtn) sendBtn.style.display = 'none';
			if (stopBtn) stopBtn.style.display = 'block';
		} else {
			if (sendBtn) sendBtn.style.display = 'flex';
			if (stopBtn) stopBtn.style.display = 'none';
		}
	}

	function endStreamUI() {
		setStreamingUI(false);
		pendingAssistantTurnEl = null;
		const indicator = document.querySelector('.typing-indicator');
		if (indicator) indicator.remove();
	}

	function escapeHtml(str) {
		if (!str) return '';
		return str
			.replace(/&/g, '&amp;')
			.replace(/</g, '&lt;')
			.replace(/>/g, '&gt;')
			.replace(/"/g, '&quot;')
			.replace(/'/g, '&#039;');
	}

	function renderMarkdown(raw) {
		if (!raw) return '';
		try {
			let clean = raw;

			// Convert <tool_call> and <actions> wrappers into markdown action tags
			clean = clean.replace(/<tool_call>([\s\S]*?)<\/tool_call>/g, function(_m, inner) {
				try {
					const parsed = JSON.parse(inner.trim());
					if (parsed.name === 'write_file') {
						return '\n```file:' + (parsed.arguments?.path || 'file') + '\n' + (parsed.arguments?.content || '') + '\n```\n';
					} else if (parsed.name === 'execute_command') {
						return '\n```bash:run\n' + (parsed.arguments?.command || '') + '\n```\n';
					}
				} catch (e) {}
				return '';
			});

			const codeBlockRegex = /```([a-zA-Z0-9_\-\.\/:]+)?\n([\s\S]*?)(?:```|$)/g;
			let html = '';
			let lastIndex = 0;
			let match;

			while ((match = codeBlockRegex.exec(clean)) !== null) {
				const preceding = clean.substring(lastIndex, match.index);
				html += renderTextParagraphs(preceding);

				const rawTag = (match[1] || '').trim().toLowerCase();
				const blockBody = match[2];

				// 1. Check if block is a JSON tool call
				let isToolCall = false;
				if (rawTag === 'json' || rawTag === '') {
					try {
						const parsed = JSON.parse(blockBody.trim());
						if (parsed.name === 'write_file') {
							isToolCall = true;
							const fileName = parsed.arguments?.path || 'file';
							const statusText = isStreaming
								? '<strong>Forging file:</strong> <code>' + escapeHtml(fileName) + '</code> &bull; <em>Streaming code to disk...</em>'
								: '<strong>Created file:</strong> <code>' + escapeHtml(fileName) + '</code>';
							html += '<div class="file-action-badge ' + (isStreaming ? 'forging' : 'created') + '" data-file="' + escapeHtml(fileName) + '" onclick="vscode.postMessage({ type: \'openFile\', path: \'' + escapeHtml(fileName) + '\' })">' +
								'<span class="file-icon">' + (isStreaming ? '🔥' : '📄') + '</span> <span>' + statusText + '</span>' +
							'</div>';
						} else if (parsed.name === 'execute_command') {
							isToolCall = true;
							const cmd = parsed.arguments?.command || '';
							html += '<div class="file-action-badge ' + (isStreaming ? 'forging' : 'created') + '" data-cmd="' + escapeHtml(cmd) + '">' +
								'<span class="file-icon">⚡</span> <span><strong>' + (isStreaming ? 'Executing:' : 'Executed:') + '</strong> <code>' + escapeHtml(cmd) + '</code></span>' +
							'</div>';
						}
					} catch (e) {
						// Check if partially streamed tool JSON
						if (isStreaming && blockBody.includes('"name"') && blockBody.includes('write_file')) {
							isToolCall = true;
							const pathMatch = blockBody.match(/"path"\s*:\s*"([^"]+)/);
							const fileName = pathMatch ? pathMatch[1] : 'file...';
							html += '<div class="file-action-badge forging">' +
								'<span class="file-icon">🔥</span> <span><strong>Forging file:</strong> <code>' + escapeHtml(fileName) + '</code> &bull; <em>Streaming code to disk...</em></span>' +
							'</div>';
						} else if (isStreaming && blockBody.includes('"name"') && blockBody.includes('execute_command')) {
							isToolCall = true;
							const cmdMatch = blockBody.match(/"command"\s*:\s*"([^"]+)/);
							const cmd = cmdMatch ? cmdMatch[1] : 'command...';
							html += '<div class="file-action-badge forging">' +
								'<span class="file-icon">⚡</span> <span><strong>Executing:</strong> <code>' + escapeHtml(cmd) + '</code></span>' +
							'</div>';
						}
					}
				}

				// 2. Check for explicit file fences: ```file:path or ```write:path
				if (!isToolCall) {
					if (rawTag.startsWith('file:') || rawTag.startsWith('write:') || rawTag.startsWith('create:') || (rawTag.includes(':') && !rawTag.includes('run'))) {
						const fileName = rawTag.includes(':') ? rawTag.split(':').slice(1).join(':').trim() : rawTag;
						const statusText = isStreaming
							? '<strong>Forging file:</strong> <code>' + escapeHtml(fileName) + '</code> &bull; <em>Streaming code to disk...</em>'
							: '<strong>Created file:</strong> <code>' + escapeHtml(fileName) + '</code>';
						html += '<div class="file-action-badge ' + (isStreaming ? 'forging' : 'created') + '" data-file="' + escapeHtml(fileName) + '" onclick="vscode.postMessage({ type: \'openFile\', path: \'' + escapeHtml(fileName) + '\' })">' +
							'<span class="file-icon">' + (isStreaming ? '🔥' : '📄') + '</span> <span>' + statusText + '</span>' +
						'</div>';
					} else if (rawTag === 'bash:run' || rawTag === 'sh:run' || rawTag === 'terminal:run' || rawTag === 'bash' || rawTag === 'sh') {
						const cmd = blockBody.trim();
						html += '<div class="file-action-badge ' + (isStreaming ? 'forging' : 'created') + '" data-cmd="' + escapeHtml(cmd) + '">' +
							'<span class="file-icon">⚡</span> <span><strong>' + (isStreaming ? 'Executing:' : 'Executed:') + '</strong> <code>' + escapeHtml(cmd) + '</code></span>' +
						'</div>';
					} else {
						// Clean read-only code display with zero buttons
						const lang = escapeHtml(rawTag || 'code');
						const escaped = escapeHtml(blockBody);
						html += '<div class="code-block">' +
							'<div class="code-header">' +
								'<span>' + lang + '</span>' +
							'</div>' +
							'<pre><code>' + escaped + '</code></pre>' +
						'</div>';
					}
				}

				lastIndex = match.index + match[0].length;
			}

			const remaining = clean.substring(lastIndex);
			html += renderTextParagraphs(remaining);
			return html;
		} catch (err) {
			return '<p>' + escapeHtml(String(raw)) + '</p>';
		}
	}

	function renderTextParagraphs(text) {
		if (!text) return '';
		const withInlineCode = escapeHtml(text).replace(/`([^`]+)`/g, '<code class="inline-code">$1</code>');
		const paragraphs = withInlineCode.split(/\n\n+/);
		return paragraphs.map(function(p) {
			const trimmed = p.trim();
			if (!trimmed) return '';
			return '<p>' + trimmed.replace(/\n/g, '<br>') + '</p>';
		}).filter(Boolean).join('');
	}

	function hydrateHistory(messages) {
		if (!messages || messages.length === 0 || isStreaming) return;
		const existing = messagesContainer.querySelectorAll('.message-bubble');
		if (existing.length > 0) return; // Already populated

		if (emptyState) emptyState.style.display = 'none';

		messages.forEach(function(msg) {
			const div = document.createElement('div');
			div.className = 'message-bubble ' + (msg.role === 'user' ? 'user' : 'assistant');
			if (msg.role === 'assistant') {
				div.innerHTML = '<div class="message-header">CodeAlloy Agent &bull; Local Engine</div>' +
					'<div class="message-content">' + renderMarkdown(msg.content) + '</div>';
			} else {
				div.innerHTML = '<div class="message-content">' + renderMarkdown(msg.content) + '</div>';
			}
			messagesContainer.appendChild(div);
		});

		messagesContainer.scrollTop = messagesContainer.scrollHeight;
	}

	// Listen for messages from extension host
	window.addEventListener('message', function(event) {
		const message = event.data;
		if (!message || !message.type) return;

		switch (message.type) {
			case 'syncState': {
				const providerLabel = message.provider === 'external' ? 'External Endpoint' : 'Metal GPU Engine';
				if (message.activeModel && message.serverRunning) {
					if (modelNameEl) modelNameEl.textContent = message.activeModel;
					if (statusDotEl) statusDotEl.className = 'status-dot';
					if (modelBadgeEl) modelBadgeEl.title = 'Active: ' + message.activeModel + ' (' + providerLabel + ' online)';

					if (emptyTitle && emptyDesc && emptyActions) {
						if (emptyFlame) emptyFlame.textContent = '🔥';
						emptyTitle.innerHTML = 'Forge Agent Ready';
						const engineText = message.provider === 'external' ? 'Connected to external model endpoint.' : 'Local Metal GPU engine is active and private.';
						emptyDesc.innerHTML = '<span class="model-tag">' + escapeHtml(message.activeModel) + '</span><br><span style="margin-top: 4px; display: inline-block;">' + engineText + ' Ask questions or click a quick prompt below:</span>';
						emptyActions.innerHTML = '<div class="prompt-chips">' +
							'<button class="chip-btn" onclick="sendQuickPrompt(\'Explain how this project is structured and what it does\')">&#9889; Explain project architecture</button>' +
							'<button class="chip-btn" onclick="sendQuickPrompt(\'Write unit tests for the active code with edge cases\')">&#128736; Generate unit tests</button>' +
							'<button class="chip-btn" onclick="sendQuickPrompt(\'Refactor the active code for better performance and readability\')">&#10024; Refactor and optimize</button>' +
							'</div>' +
							'<div style="margin-top: 10px;">' +
							'<button class="clear-btn" onclick="triggerSelectModel()" style="text-decoration: underline;">Switch model...</button>' +
							'</div>';
					}
				} else if (message.activeModel) {
					if (modelNameEl) modelNameEl.textContent = message.activeModel;
					if (statusDotEl) statusDotEl.className = 'status-dot offline';
					if (modelBadgeEl) modelBadgeEl.title = 'Active: ' + message.activeModel + ' (' + providerLabel + ' standby)';

					if (emptyTitle && emptyDesc && emptyActions) {
						if (emptyFlame) emptyFlame.textContent = '⚡';
						emptyTitle.innerHTML = 'Model Ready (Standby)';
						emptyDesc.innerHTML = '<span class="model-tag">' + escapeHtml(message.activeModel) + '</span><br><span style="margin-top: 4px; display: inline-block;">Click below or send a prompt to ignite the local engine:</span>';
						emptyActions.innerHTML = '<button class="btn-primary" onclick="sendQuickPrompt(\'Hello CodeAlloy! Confirm engine is online.\')">&#128293; Ignite Local Engine</button>' +
							'<div style="margin-top: 10px;">' +
							'<button class="clear-btn" onclick="triggerSelectModel()" style="text-decoration: underline;">Switch model...</button>' +
							'</div>';
					}
				} else {
					if (modelNameEl) modelNameEl.textContent = 'No Model Active';
					if (statusDotEl) statusDotEl.className = 'status-dot offline';
					if (modelBadgeEl) modelBadgeEl.title = 'Click to select or download a local model';

					if (emptyTitle && emptyDesc && emptyActions) {
						if (emptyFlame) emptyFlame.textContent = '❄️';
						emptyTitle.innerHTML = 'No Local Model Active';
						emptyDesc.innerHTML = 'Pick an installed GGUF model or download an open coding model with 1 click.';
						emptyActions.innerHTML = '<button class="btn-primary" onclick="triggerSelectModel()">Select or Download Model</button>';
					}
				}

				if (message.autonomyLevel && autonomyDial) {
					autonomyDial.querySelectorAll('.autonomy-dial-btn').forEach(function(btn) {
						btn.classList.toggle('active', btn.getAttribute('data-level') === message.autonomyLevel);
					});
				}

				if (message.messages && message.messages.length > 0) {
					hydrateHistory(message.messages);
				}
				break;
			}

			case 'streamStart': {
				if (emptyState) emptyState.style.display = 'none';
				setStreamingUI(true);

				// If we already created an optimistic turn, adopt the real ID
				if (pendingAssistantTurnEl) {
					pendingAssistantTurnEl.id = message.assistantMsgId;
					currentAssistantTurnId = message.assistantMsgId;
				} else {
					// 1. Render user message
					const userDiv = document.createElement('div');
					userDiv.className = 'message-bubble user';
					userDiv.innerHTML = '<div class="message-content">' + renderMarkdown(message.userMsg.content) + '</div>';
					messagesContainer.appendChild(userDiv);

					// 2. Render assistant turn container
					currentAssistantTurnId = message.assistantMsgId;
					const asstDiv = document.createElement('div');
					asstDiv.className = 'message-bubble assistant';
					asstDiv.id = message.assistantMsgId;
					asstDiv.innerHTML = '<div class="message-header">CodeAlloy Agent &bull; Local Engine</div>' +
						'<div class="message-content">' +
							'<div class="forging-banner"><span class="flame-icon">🔥</span> <span>Thinking & forging response with local model...</span></div>' +
						'</div>';
					messagesContainer.appendChild(asstDiv);
					pendingAssistantTurnEl = asstDiv;
				}

				messagesContainer.scrollTop = messagesContainer.scrollHeight;
				break;
			}

			case 'streamChunk': {
				try {
					const asstDiv = document.getElementById(message.assistantMsgId) ||
					                pendingAssistantTurnEl ||
					                messagesContainer.querySelector('.message-bubble.assistant:last-child');
					if (asstDiv) {
						if (!asstDiv._rawText) asstDiv._rawText = '';
						asstDiv._rawText += message.chunk;
						if (asstDiv._rawText.trim().length > 0) {
							const contentEl = asstDiv.querySelector('.message-content');
							if (contentEl) {
								contentEl.innerHTML = renderMarkdown(asstDiv._rawText) + '<span class="typing-indicator"></span>';
							}
						}
						messagesContainer.scrollTop = messagesContainer.scrollHeight;
					}
				} catch (err) {
					console.error('[AgentChat] Error handling chunk:', err);
				}
				break;
			}

			case 'streamEnd': {
				try {
					const asstDiv = document.getElementById(message.assistantMsgId) ||
					                pendingAssistantTurnEl ||
					                messagesContainer.querySelector('.message-bubble.assistant:last-child');
					if (asstDiv) {
						const finalContent = message.fullContent || asstDiv._rawText || '';
						const contentEl = asstDiv.querySelector('.message-content');
						if (contentEl) {
							contentEl.innerHTML = renderMarkdown(finalContent);
						}
						messagesContainer.scrollTop = messagesContainer.scrollHeight;
					}
				} catch (err) {
					console.error('[AgentChat] Error handling streamEnd:', err);
				} finally {
					endStreamUI();
				}
				break;
			}

			case 'fileCreated': {
				const asstDiv = document.getElementById(message.assistantMsgId) ||
				                pendingAssistantTurnEl ||
				                messagesContainer.querySelector('.message-bubble.assistant:last-child');
				if (asstDiv) {
					let chip = asstDiv.querySelector('.file-action-badge[data-file="' + message.fileName + '"]') ||
					           asstDiv.querySelector('.file-action-badge');
					if (!chip) {
						chip = document.createElement('div');
						chip.className = 'file-action-badge created';
						asstDiv.appendChild(chip);
					}
					chip.className = 'file-action-badge created';
					chip.setAttribute('data-file', message.fileName);
					chip.onclick = function() {
						vscode.postMessage({ type: 'openFile', path: message.filePath });
					};
					chip.innerHTML = '<span class="file-icon">✓</span> <span><strong>Created &amp; Opened:</strong> <code>' + escapeHtml(message.fileName) + '</code> &bull; <span class="file-size">' + escapeHtml(message.filePath) + '</span></span>';
					messagesContainer.scrollTop = messagesContainer.scrollHeight;
				}
				break;
			}

			case 'commandCompleted': {
				const asstDiv = document.getElementById(message.assistantMsgId) ||
				                pendingAssistantTurnEl ||
				                messagesContainer.querySelector('.message-bubble.assistant:last-child');
				if (asstDiv) {
					let chip = asstDiv.querySelector('.file-action-badge[data-cmd="' + message.command + '"]');
					if (!chip) {
						chip = document.createElement('div');
						chip.className = 'file-action-badge ' + (message.success ? 'created' : '');
						asstDiv.appendChild(chip);
					}
					chip.className = 'file-action-badge ' + (message.success ? 'created' : '');
					chip.innerHTML = '<span class="file-icon">' + (message.success ? '✓' : '✗') + '</span> <span><strong>' + (message.success ? 'Executed:' : 'Failed:') + '</strong> <code>' + escapeHtml(message.command) + '</code></span>';
					messagesContainer.scrollTop = messagesContainer.scrollHeight;
				}
				break;
			}

			case 'chatCleared': {
				if (messagesContainer) {
					messagesContainer.innerHTML = '';
					if (emptyState) {
						messagesContainer.appendChild(emptyState);
						emptyState.style.display = 'block';
					}
				}
				endStreamUI();
				break;
			}

			case 'actionApprovalRequired': {
				const asstDiv = document.getElementById(message.assistantMsgId) ||
				                pendingAssistantTurnEl ||
				                messagesContainer.querySelector('.message-bubble.assistant:last-child');
				if (asstDiv) {
					const card = document.createElement('div');
					card.className = 'action-approval-card active-approval';
					card.id = 'approval-' + message.actionId;
					card.setAttribute('data-action-id', message.actionId);

					const typeLabel = message.actionType === 'file' ? 'Write File' : 'Run Shell Command';
					const typeIcon = message.actionType === 'file' ? '📄' : '⚡';

					card.innerHTML =
						'<div class="approval-header">' +
							'<span class="approval-type"><span class="approval-icon">' + typeIcon + '</span> L2 Approval Required: ' + escapeHtml(typeLabel) + '</span>' +
						'</div>' +
						'<div class="approval-target">' + escapeHtml(message.target) + '</div>' +
						(message.details ? '<div class="approval-details">' + escapeHtml(message.details) + '</div>' : '') +
						'<div class="approval-actions">' +
							'<button class="btn-approve" onclick="window.approveAction(\'' + escapeHtml(message.actionId) + '\')">Approve (Enter)</button>' +
							'<button class="btn-reject" onclick="window.rejectAction(\'' + escapeHtml(message.actionId) + '\')">Reject (Esc)</button>' +
							'<span class="approval-hint">Enter to allow &bull; Esc to block</span>' +
						'</div>';

					asstDiv.appendChild(card);
					messagesContainer.scrollTop = messagesContainer.scrollHeight;
				}
				break;
			}

			case 'turnCheckpointed': {
				const asstDiv = document.getElementById(message.assistantMsgId) ||
				                pendingAssistantTurnEl ||
				                messagesContainer.querySelector('.message-bubble.assistant:last-child');
				if (asstDiv) {
					let actionsBar = asstDiv.querySelector('.turn-actions-bar');
					if (!actionsBar) {
						actionsBar = document.createElement('div');
						actionsBar.className = 'turn-actions-bar';
						asstDiv.appendChild(actionsBar);
					}
					const fileCount = message.modifiedFiles ? message.modifiedFiles.length : 0;
					actionsBar.innerHTML =
						'<button class="undo-turn-btn" id="undo-btn-' + escapeHtml(message.assistantMsgId) + '" ' +
						'onclick="window.undoTurn(\'' + escapeHtml(message.assistantMsgId) + '\', \'' + escapeHtml(message.commitHash) + '\')" ' +
						'title="Revert all changes made during this turn">' +
						'<span>&#8630; Undo Turn</span> <span style="font-size: 9.5px; opacity: 0.85;">(' + fileCount + ' file' + (fileCount === 1 ? '' : 's') + ')</span>' +
						'</button>';
					messagesContainer.scrollTop = messagesContainer.scrollHeight;
				}
				break;
			}

			case 'turnRolledBack': {
				const btn = document.getElementById('undo-btn-' + message.assistantMsgId);
				if (btn) {
					btn.className = 'undo-turn-btn reverted';
					btn.innerHTML = '<span>&#10003; Reverted to pre-turn state</span>';
				}
				break;
			}

			case 'timelineLoaded': {
				if (timelineList) {
					const list = message.timeline || [];
					if (list.length === 0) {
						timelineList.innerHTML = '<div class="timeline-empty">No checkpoints recorded yet. Snapshots are taken before every agent turn.</div>';
					} else {
						timelineList.innerHTML = list.slice().reverse().map(function(item) {
							const dateStr = new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
							const fileCount = item.filesModified ? item.filesModified.length : 0;
							const filesStr = fileCount > 0 ? item.filesModified.join(', ') : 'No files modified';
							return '<div class="timeline-item">' +
								'<div class="timeline-item-meta">' +
									'<span>' + escapeHtml(dateStr) + '</span>' +
									'<span class="timeline-commit-hash">#' + escapeHtml(item.commitHash.substring(0, 8)) + '</span>' +
								'</div>' +
								'<div class="timeline-prompt-preview" title="' + escapeHtml(item.prompt) + '">' + escapeHtml(item.prompt) + '</div>' +
								'<div class="timeline-files-list" title="' + escapeHtml(filesStr) + '">' +
									(fileCount > 0 ? '&#128221; ' + fileCount + ' file(s): ' + escapeHtml(filesStr) : 'Advisory / read-only') +
								'</div>' +
								'<button class="btn-revert-timeline" onclick="window.revertToTimelinePoint(\'' + escapeHtml(item.commitHash) + '\')">' +
									'Revert to this point' +
								'</button>' +
							'</div>';
						}).join('');
					}
				}
				break;
			}

			case 'timelineRolledBack': {
				if (timelineDrawer) {
					timelineDrawer.style.display = 'none';
				}
				break;
			}

			case 'showNotice': {
				endStreamUI();
				const noticeDiv = document.createElement('div');
				noticeDiv.className = 'message-bubble assistant';
				noticeDiv.style.borderColor = message.level === 'error' ? 'var(--ca-error)' : 'var(--ca-amber)';
				noticeDiv.innerHTML = '<div class="message-content" style="color: ' + (message.level === 'error' ? 'var(--ca-error)' : 'var(--ca-gold)') + '; font-weight: 500;">' +
					escapeHtml(message.message) +
				'</div>';
				messagesContainer.appendChild(noticeDiv);
				messagesContainer.scrollTop = messagesContainer.scrollHeight;
				break;
			}
		}
	});
})();
