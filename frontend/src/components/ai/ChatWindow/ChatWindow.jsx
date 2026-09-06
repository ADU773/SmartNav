/**
 * SmartNav360 — ChatWindow
 * AI chat interface with message bubbles and suggested prompts.
 */

import { useState } from 'react';
import { Input, Button, Tag, Space } from 'antd';
import { SendOutlined, RobotOutlined, UserOutlined } from '@ant-design/icons';
import './ChatWindow.css';

const SUGGESTED_PROMPTS = [
  'How do I create a new scene?',
  'Show the shortest path between two locations.',
  'What scenes are connected to the entrance?',
  'Suggest an optimal navigation route.',
  'Help me organize my project structure.',
];

export default function ChatWindow({ onSend, messages = [], loading }) {
  const [input, setInput] = useState('');

  const handleSend = () => {
    if (!input.trim()) return;
    onSend?.(input.trim());
    setInput('');
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="chat-window">
      {/* Messages */}
      <div className="chat-window__messages">
        {messages.length === 0 ? (
          <div className="chat-window__empty">
            <RobotOutlined className="chat-window__empty-icon" />
            <h3>AI Workspace</h3>
            <p>Ask about your project or request navigation assistance. Gemini responses activate when its private API key is configured.</p>
            <div className="chat-window__prompts">
              <p className="chat-window__prompts-label">Suggested questions</p>
              <Space wrap>
                {SUGGESTED_PROMPTS.map((prompt, idx) => (
                  <Tag
                    key={idx}
                    className="chat-window__prompt-tag"
                    onClick={() => {
                      setInput(prompt);
                      onSend?.(prompt);
                    }}
                  >
                    {prompt}
                  </Tag>
                ))}
              </Space>
            </div>
          </div>
        ) : (
          messages.map((msg, idx) => (
            <div
              key={idx}
              className={`chat-window__bubble chat-window__bubble--${msg.role}`}
            >
              <div className="chat-window__bubble-avatar">
                {msg.role === 'user' ? <UserOutlined /> : <RobotOutlined />}
              </div>
              <div className="chat-window__bubble-content">
                <p>{msg.content}</p>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Input */}
      <div className="chat-window__input">
        <Input.TextArea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask a question about your project..."
          autoSize={{ minRows: 1, maxRows: 4 }}
          className="chat-window__textarea"
        />
        <Button
          type="primary"
          icon={<SendOutlined />}
          onClick={handleSend}
          loading={loading}
          disabled={!input.trim()}
        />
      </div>
    </div>
  );
}
