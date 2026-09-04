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

	window.triggerSelectModel = function() {
		vscode.postMessage({ type: 'selectModel' });
	};

	window.sendQuickPrompt = function(promptText) {
		if (isStreaming) return;
		executeSend(promptText);
	};

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
		const codeBlockRegex = /```([a-zA-Z0-9_\-]+)?\n([\s\S]*?)```/g;
		let html = '';
		let lastIndex = 0;
		let match;

		while ((match = codeBlockRegex.exec(raw)) !== null) {
			const preceding = raw.substring(lastIndex, match.index);
			html += renderTextParagraphs(preceding);

			const lang = match[1] || 'code';
			const codeContent = match[2];
			const escaped = escapeHtml(codeContent);

			html += '<div class="code-block">' +
				'<div class="code-header">' +
					'<span>' + escapeHtml(lang) + '</span>' +
					'<div class="code-actions">' +
						'<button class="code-action-btn" onclick="insertCodeAtCursor(this)">Insert at Cursor</button>' +
						'<button class="code-action-btn" onclick="copyCode(this)">Copy</button>' +
					'</div>' +
				'</div>' +
				'<pre><code>' + escaped + '</code></pre>' +
			'</div>';

			lastIndex = match.index + match[0].length;
		}

		const remaining = raw.substring(lastIndex);
		html += renderTextParagraphs(remaining);
		return html;
	}

	function renderTextParagraphs(text) {
		if (!text) return '';
		const withInlineCode = escapeHtml(text).replace(/`([^`]+)`/g, '<code class="inline-code">$1</code>');
		const paragraphs = withInlineCode.split(/\n\n+/);
		return paragraphs.map(function(p) {
			return '<p>' + p.replace(/\n/g, '<br>') + '</p>';
		}).join('');
	}

	window.insertCodeAtCursor = function(btn) {
		const block = btn.closest('.code-block');
		if (!block) return;
		const codeEl = block.querySelector('pre code');
		if (codeEl) {
			vscode.postMessage({
				type: 'insertAtCursor',
				text: codeEl.textContent
			});
			const oldText = btn.textContent;
			btn.textContent = 'Inserted!';
			setTimeout(function() { btn.textContent = oldText; }, 1500);
		}
	};

	window.copyCode = function(btn) {
		const block = btn.closest('.code-block');
		if (!block) return;
		const codeEl = block.querySelector('pre code');
		if (codeEl) {
			navigator.clipboard.writeText(codeEl.textContent);
			const oldText = btn.textContent;
			btn.textContent = 'Copied!';
			setTimeout(function() { btn.textContent = oldText; }, 1500);
		}
	};

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
				if (message.activeModel && message.serverRunning) {
					if (modelNameEl) modelNameEl.textContent = message.activeModel;
					if (statusDotEl) statusDotEl.className = 'status-dot';
					if (modelBadgeEl) modelBadgeEl.title = 'Active: ' + message.activeModel + ' (Metal GPU Engine online)';

					if (emptyTitle && emptyDesc && emptyActions) {
						if (emptyFlame) emptyFlame.textContent = '🔥';
						emptyTitle.innerHTML = 'Forge Agent Ready';
						emptyDesc.innerHTML = '<span class="model-tag">' + escapeHtml(message.activeModel) + '</span><br><span style="margin-top: 4px; display: inline-block;">Local Metal GPU engine is active and private. Ask questions or click a quick prompt below:</span>';
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
					if (modelBadgeEl) modelBadgeEl.title = 'Active: ' + message.activeModel + ' (Engine standby)';

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
				const asstDiv = document.getElementById(message.assistantMsgId) ||
				                pendingAssistantTurnEl ||
				                messagesContainer.querySelector('.message-bubble.assistant:last-child');
				if (asstDiv) {
					if (!asstDiv._rawText) asstDiv._rawText = '';
					asstDiv._rawText += message.chunk;
					const contentEl = asstDiv.querySelector('.message-content');
					if (contentEl) {
						contentEl.innerHTML = renderMarkdown(asstDiv._rawText) + '<span class="typing-indicator"></span>';
					}
					messagesContainer.scrollTop = messagesContainer.scrollHeight;
				}
				break;
			}

			case 'streamEnd': {
				const asstDiv = document.getElementById(message.assistantMsgId) ||
				                pendingAssistantTurnEl ||
				                messagesContainer.querySelector('.message-bubble.assistant:last-child');
				if (asstDiv) {
					const contentEl = asstDiv.querySelector('.message-content');
					if (contentEl) {
						contentEl.innerHTML = renderMarkdown(message.fullContent || asstDiv._rawText || '');
					}
					messagesContainer.scrollTop = messagesContainer.scrollHeight;
				}
				endStreamUI();
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
