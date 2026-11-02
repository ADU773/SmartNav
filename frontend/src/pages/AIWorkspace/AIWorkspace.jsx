/**
 * SmartNav360 — AI Workspace Page
 * AI-powered assistant for navigation and project management.
 */

import { useEffect, useState } from 'react';
import { Card, Row, Col, Tag, Input, Button } from 'antd';
import { CompassOutlined, SearchOutlined, EditOutlined, PlusOutlined } from '@ant-design/icons';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';
import AIService from '../../services/ai.service';
import ProjectService from '../../services/project.service';
import ChatWindow from '../../components/ai/ChatWindow';
import WorkspaceHeader from '../../components/layout/WorkspaceHeader';
import './AIWorkspace.css';
import { useProject } from '../../contexts/ProjectContext';
import { useNotification } from '../../contexts/NotificationContext';

// Matches the server's limit (projectController.updateProject).
const MAX_INSTRUCTIONS = 1500;
// Earlier turns sent with each message so follow-up questions make sense.
const HISTORY_TURNS = 8;

const INSTRUCTION_EXAMPLE = 'e.g. Reply in Malayalam. The main entrance is the scene "Front Gate". '
  + 'Always mention the lift for wheelchair users.';

export default function AIWorkspace() {
  useDocumentTitle('AI Workspace');

  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(false);
  const { currentProject, selectProject } = useProject();
  const { success: notifySuccess, error: notifyError } = useNotification();
  const [instructions, setInstructions] = useState(currentProject?.assistantInstructions || '');
  const [savingInstructions, setSavingInstructions] = useState(false);
  // The model that wrote the last reply, as reported by the server.
  const [model, setModel] = useState(null);

  const savedInstructions = currentProject?.assistantInstructions || '';
  useEffect(() => { setInstructions(savedInstructions); }, [currentProject?._id, savedInstructions]);
  // A conversation belongs to one project.
  useEffect(() => { setMessages([]); }, [currentProject?._id]);

  const handleSend = async (content) => {
    // Failed replies are shown but never sent back to the model as history.
    const history = messages
      .filter((message) => !message.error)
      .slice(-HISTORY_TURNS)
      .map(({ role, content: text }) => ({ role, content: text }));
    setMessages((prev) => [...prev, { role: 'user', content }]);
    setLoading(true);

    try {
      const result = await AIService.sendMessage(content, { projectId: currentProject?._id, history });
      if (result.success) {
        setModel(result.data.model || null);
        setMessages((prev) => [
          ...prev,
          { role: 'assistant', content: result.data.reply },
        ]);
      }
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: err.message || 'Sorry, an error occurred. Please try again.', error: true },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const saveInstructions = async () => {
    if (!currentProject) return;
    setSavingInstructions(true);
    try {
      const result = await ProjectService.updateProject(currentProject._id, { assistantInstructions: instructions });
      if (result.success) {
        selectProject(result.data);
        notifySuccess('Instructions saved. They apply to the next message.');
      }
    } catch (err) {
      notifyError(err.message || 'Could not save the instructions.');
    } finally {
      setSavingInstructions(false);
    }
  };

  return (
    <div className="ai-workspace">
      <WorkspaceHeader
        title="AI Workspace"
        description="Ask about your scenes, what is in them, or the best route through your experience."
        actions={messages.length ? (
          <Button icon={<PlusOutlined />} onClick={() => setMessages([])} disabled={loading}>New chat</Button>
        ) : null}
      />

      <Row gutter={[16, 16]}>
        <Col xs={24} lg={16}>
          <ChatWindow messages={messages} onSend={handleSend} loading={loading} />
        </Col>

        <Col xs={24} lg={8}>
          <Card title="Custom instructions" className="ai-workspace__card">
            <p className="ai-workspace__hint">
              Added to every conversation in this project: language, tone, what to point out.
              The assistant still answers only from your project&apos;s data.
            </p>
            <Input.TextArea
              value={instructions}
              onChange={(event) => setInstructions(event.target.value)}
              placeholder={INSTRUCTION_EXAMPLE}
              maxLength={MAX_INSTRUCTIONS}
              showCount
              autoSize={{ minRows: 4, maxRows: 10 }}
              disabled={!currentProject}
            />
            <Button
              type="primary"
              icon={<EditOutlined />}
              onClick={saveInstructions}
              loading={savingInstructions}
              disabled={!currentProject || instructions.trim() === savedInstructions}
              className="ai-workspace__save"
            >
              Save instructions
            </Button>
          </Card>

          <Card title="What the assistant can do" style={{ marginTop: 16 }}>
            <div className="ai-workspace__capability">
              <CompassOutlined className="ai-workspace__capability-icon" />
              <div>
                <h4>Routes between scenes</h4>
                <p>Computed by the route finder, including step-free routes without stairs or escalators</p>
                <Tag color="green">Uses project data</Tag>
              </div>
            </div>
            <div className="ai-workspace__capability">
              <SearchOutlined className="ai-workspace__capability-icon" />
              <div>
                <h4>Find objects</h4>
                <p>Which scenes contain an object found by the detector, and how many</p>
                <Tag color="green">Uses project data</Tag>
              </div>
            </div>
          </Card>

          <Card title="Integration Status" style={{ marginTop: 16 }}>
            <div className="ai-workspace__status">
              <span>Chat Assistant</span>
              <Tag color={currentProject ? 'green' : 'default'}>{currentProject ? (model || 'Ready') : 'Choose a project'}</Tag>
            </div>
            <div className="ai-workspace__status">
              <span>Navigation Engine</span>
              <Tag color="green">Available</Tag>
            </div>
            <div className="ai-workspace__status">
              <span>Computer Vision</span>
              <Tag color="green">Local model</Tag>
            </div>
          </Card>
        </Col>
      </Row>
    </div>
  );
}
