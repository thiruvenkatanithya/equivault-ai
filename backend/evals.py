import yaml
from app.core.rag_chain import equivault_agent
from app.core.guardrails import EquiVaultGuardrails

# A "Golden Dataset" of questions and expected answers for evaluation
GOLDEN_DATASET = [
    {
        "query": "What is the basic strategy for value investing?",
        "expected_keywords": ["undervalued", "intrinsic value", "margin of safety"],
        "role": "Basic"
    },
    {
        "query": "How does advanced hedging work in stock portfolios?",
        "expected_keywords": ["options", "offset", "risk mitigation", "hedging"],
        "role": "Premium"
    }
]

def run_evaluations():
    print("--- Starting EquiVault AI Evaluation ---")
    results = []
    
    for item in GOLDEN_DATASET:
        print(f"Testing Query: {item['query']} (Role: {item['role']})")
        
        # Invoke the agent
        state = {
            "messages": [],
            "query": item['query'],
            "user_role": item['role'],
            "context": [],
            "next_step": "",
            "final_answer": "",
            "requires_human": False
        }
        
        final_state = equivault_agent.invoke(state)
        answer = final_state.get("final_answer", "")
        
        # Evaluation Logic: Check if expected keywords are present (Faithfulness/Relevance)
        score = sum(1 for kw in item['expected_keywords'] if kw.lower() in answer.lower())
        accuracy = (score / len(item['expected_keywords'])) * 100
        
        # Guardrail Check
        is_safe, _ = EquiVaultGuardrails.check_output(answer)
        
        results.append({
            "query": item['query'],
            "accuracy": f"{accuracy}%",
            "safe": "Yes" if is_safe else "No"
        })
        print(f"Result: Accuracy {accuracy}% | Safe: {is_safe}")

    print("\n--- Evaluation Summary ---")
    for r in results:
        print(f"Query: {r['query']} -> Acc: {r['accuracy']} | Safe: {r['safe']}")

if __name__ == "__main__":
    run_evaluations()
