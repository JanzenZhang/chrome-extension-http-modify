import { Component, OnInit, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

interface HeaderConfig {
  key: string;
  value: string;
}

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.css']
})
export class AppComponent implements OnInit {
  headers: HeaderConfig[] = [];
  enabled: boolean = true;
  statusMsg: string = '';

  constructor(private cdr: ChangeDetectorRef) {}

  ngOnInit() {
    this.loadConfig();
  }

  loadConfig() {
    if (typeof chrome !== 'undefined' && chrome.storage) {
      chrome.storage.local.get(['headers', 'enabled'], (result: { [key: string]: any }) => {
        if (result['headers'] && Array.isArray(result['headers']) && result['headers'].length > 0) {
          this.headers = result['headers'] as HeaderConfig[];
        } else {
          this.headers = [{ key: '', value: '' }];
        }
        this.enabled = result['enabled'] !== false;
        this.cdr.detectChanges();
      });
    } else {
      // Mock for development outside extension
      this.headers = [{ key: 'X-Test', value: '123' }];
    }
  }

  addHeader() {
    this.headers.push({ key: '', value: '' });
  }

  removeHeader(index: number) {
    this.headers.splice(index, 1);
    if (this.headers.length === 0) {
      this.addHeader();
    }
  }

  async saveConfig() {
    // Filter out empty keys
    const validHeaders = this.headers.filter(h => h.key.trim() !== '');

    if (typeof chrome !== 'undefined' && chrome.storage) {
      await chrome.storage.local.set({ headers: validHeaders, enabled: this.enabled });
      await this.updateRules(validHeaders, this.enabled);
      
      this.statusMsg = 'Configuration saved and applied!';
      this.cdr.detectChanges();
      setTimeout(() => {
        this.statusMsg = '';
        this.cdr.detectChanges();
      }, 2000);
    } else {
      console.log('Saved:', validHeaders, this.enabled);
    }
  }

  async updateRules(headers: HeaderConfig[], enabled: boolean) {
    if (!chrome.declarativeNetRequest) return;

    const ruleId = 1;
    const existingRules = await chrome.declarativeNetRequest.getDynamicRules();
    const ruleIdsToRemove = existingRules.map(r => r.id);

    if (!enabled || headers.length === 0) {
      await chrome.declarativeNetRequest.updateDynamicRules({
        removeRuleIds: ruleIdsToRemove,
        addRules: []
      });
      return;
    }

    const newRule = {
      id: ruleId,
      priority: 1,
      action: {
        type: chrome.declarativeNetRequest.RuleActionType.MODIFY_HEADERS,
        requestHeaders: headers.map(h => ({
          header: h.key,
          operation: chrome.declarativeNetRequest.HeaderOperation.SET,
          value: h.value
        }))
      },
      condition: {
        urlFilter: '*',
        resourceTypes: [
          chrome.declarativeNetRequest.ResourceType.MAIN_FRAME,
          chrome.declarativeNetRequest.ResourceType.SUB_FRAME,
          chrome.declarativeNetRequest.ResourceType.STYLESHEET,
          chrome.declarativeNetRequest.ResourceType.SCRIPT,
          chrome.declarativeNetRequest.ResourceType.IMAGE,
          chrome.declarativeNetRequest.ResourceType.FONT,
          chrome.declarativeNetRequest.ResourceType.OBJECT,
          chrome.declarativeNetRequest.ResourceType.XMLHTTPREQUEST,
          chrome.declarativeNetRequest.ResourceType.PING,
          chrome.declarativeNetRequest.ResourceType.CSP_REPORT,
          chrome.declarativeNetRequest.ResourceType.MEDIA,
          chrome.declarativeNetRequest.ResourceType.WEBSOCKET,
          chrome.declarativeNetRequest.ResourceType.OTHER
        ]
      }
    };

    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: ruleIdsToRemove,
      addRules: [newRule]
    });
  }
}
