/**
 * SmartNav360 — AI Workspace Page
 * AI-powered assistant for navigation and project management.
 */

import { useState } from 'react';
import { Card, Row, Col, Tag } from 'antd';
import { RobotOutlined, CompassOutlined, SearchOutlined, BulbOutlined } from '@ant-design/icons';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';
import AIService from '../../services/ai.service';
import ChatWindow from '../../components/ai/ChatWindow';
import WorkspaceHeader from '../../components/layout/WorkspaceHeader';
import './AIWorkspace.css';
import { useProject } from '../../contexts/ProjectContext';

export default function AIWorkspace() {
  useDocumentTitle('AI Workspace');

  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(false);
  const { currentProject } = useProject();

  const handleSend = async (content) => {
    setMessages((prev) => [...prev, { role: 'user', content }]);
    setLoading(true);

    try {
      const result = await AIService.sendMessage(content, { projectId: currentProject?._id });
      if (result.success) {
        setMessages((prev) => [
          ...prev,
          { role: 'assistant', content: result.data.reply },
        ]);
      }
    } catch {
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: 'Sorry, an error occurred. Please try again.' },
      ]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="ai-workspace">
      <WorkspaceHeader
        title="AI Workspace"
        description="Ask about your scenes, connections, or the best route through your experience."
      />

      <Row gutter={[16, 16]}>
        <Col xs={24} lg={16}>
          <ChatWindow messages={messages} onSend={handleSend} loading={loading} />
        </Col>

        <Col xs={24} lg={8}>
          {/* AI Capabilities */}
          <Card title="AI Capabilities" className="ai-workspace__card">
            <div className="ai-workspace__capability">
              <CompassOutlined className="ai-workspace__capability-icon" />
              <div>
                <h4>Navigation Assistance</h4>
                <p>Find optimal routes between scenes</p>
                <Tag color="green">Available</Tag>
              </div>
            </div>
            <div className="ai-workspace__capability">
              <SearchOutlined className="ai-workspace__capability-icon" />
              <div>
                <h4>Smart Search</h4>
                <p>Natural language search across scenes</p>
                <Tag color="blue">Context aware</Tag>
              </div>
            </div>
            <div className="ai-workspace__capability">
              <BulbOutlined className="ai-workspace__capability-icon" />
              <div>
                <h4>Metadata Generation</h4>
                <p>Auto-generate scene descriptions</p>
                <Tag color="blue">Ready with Gemini key</Tag>
              </div>
            </div>
          </Card>

          {/* Integration Status */}
          <Card title="Integration Status" style={{ marginTop: 16 }}>
            <div className="ai-workspace__status">
              <span>Gemini API</span>
              <Tag color={currentProject ? 'green' : 'orange'}>{currentProject ? 'Connected' : 'Choose a project'}</Tag>
            </div>
            <div className="ai-workspace__status">
              <span>Navigation Engine</span>
              <Tag color="green">Available</Tag>
            </div>
            <div className="ai-workspace__status">
              <span>Computer Vision</span>
              <Tag color="blue">Service-ready</Tag>
            </div>
          </Card>
        </Col>
      </Row>
    </div>
  );
}
