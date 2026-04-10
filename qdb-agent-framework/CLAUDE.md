# QDB Agent Framework

Multi-agent AI framework for Qatar Development Bank. Regulated financial institution system with governance, audit, and human-in-the-loop controls.

## Quick Start

```bash
cd qdb-agent-framework
npm install
npm test          # Run all tests (86 tests, 10 files)
npm run dev       # Start development server
npm run simulate  # Run end-to-end workflow simulation
```

## Architecture

- **Core** (`src/core/`): Message bus, tool registry, audit logger, state store, agent runtime
- **Governance** (`src/governance/`): Policy engine, data classifier, escalation manager
- **Agents** (`src/agents/`): Router, IT Operations, PMO (extensible)
- **Tools** (`src/tools/`): Mock data/action/compliance tools with realistic QDB shapes
- **API** (`src/api/`): Hono HTTP server with chat, admin, and audit endpoints

## Key Design Decisions

- All inter-agent messaging via `MessageEnvelope` through the message bus
- Every tool invocation produces an audit log entry
- MUTATE + CONFIDENTIAL/RESTRICTED always requires human approval
- Agent policies loaded from YAML files in `policies/`
- Result<T, E> pattern for error handling (no thrown exceptions in business logic)
- Dependency injection for all core components (testable with mocks)

## Testing

```bash
npm test                    # All tests
npx vitest run tests/unit   # Unit tests only
npx vitest run tests/governance  # Governance tests
npx vitest run tests/integration # E2E integration tests
```
