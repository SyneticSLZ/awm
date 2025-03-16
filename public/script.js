// Sample trial data - In production, this would come from your database
const trialList = [
    { id: 'NCT01627782', title: 'A Study of Ketamine in Patients With Treatment-resistant Depression' },
    // Add more trials as needed
  ];
  
  document.addEventListener('DOMContentLoaded', () => {
    const trialSelect = document.getElementById('trial-selection');
    const visualizeBtn = document.getElementById('visualize-btn');
    const loadingIndicator = document.getElementById('loading-indicator');
    const visualizationContainer = document.getElementById('visualization-container');
    
    // Populate trial selection dropdown
    trialList.forEach(trial => {
      const option = document.createElement('option');
      option.value = trial.id;
      option.textContent = `${trial.id}: ${trial.title}`;
      trialSelect.appendChild(option);
    });
    
    // Event listener for visualize button
    visualizeBtn.addEventListener('click', async () => {
      const selectedTrialId = trialSelect.value;
      
      if (!selectedTrialId) {
        alert('Please select a trial to visualize');
        return;
      }
      
      // Show loading indicator
      loadingIndicator.style.display = 'block';
      visualizationContainer.innerHTML = '';
      
      try {
        // Call backend to fetch trial data and generate visualization
        const result = await generateTrialVisualization(selectedTrialId);
        
        // Insert the generated HTML into the container
        visualizationContainer.innerHTML = result.html;
        
        // If there's separate JavaScript, execute it
        if (result.javascript) {
          const script = document.createElement('script');
          script.textContent = result.javascript;
          document.body.appendChild(script);
        }
      } catch (error) {
        console.error('Error generating visualization:', error);
        visualizationContainer.innerHTML = `
          <div class="p-4 bg-red-100 text-red-700 rounded">
            Error generating visualization: ${error.message}
          </div>
        `;
      } finally {
        // Hide loading indicator
        loadingIndicator.style.display = 'none';
      }
    });
  });
  
  // Function to call the backend
  async function generateTrialVisualization(trialId) {
    const response = await fetch('/api/generate-visualization', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ trialId })
    });
    
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'Failed to generate visualization');
    }
    
    return await response.json();
  }